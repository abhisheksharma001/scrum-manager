import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { refineRequirements } from "@/lib/agents/requirements-agent";
import type { ExtractedTaskRow } from "@/lib/types";
import type { IssueTrackerProvider, IssueCreateResult } from "../types";
import {
  buildRequirementsAdf,
  buildLegacyAdf,
  mapPriority,
  normalizeString,
  levenshteinSimilarity,
} from "./jira-helpers";

const log = logger.child({ service: "jira-provider" });

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  defaultProject: string;
}

export class JiraProvider implements IssueTrackerProvider {
  readonly name = "jira";
  private _projectIssueTypes = new Map<string, Set<string>>();

  getConfig(): JiraConfig {
    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const apiToken = process.env.JIRA_API_TOKEN;
    const defaultProject = process.env.JIRA_DEFAULT_PROJECT || "SCRUM";

    if (!baseUrl || !email || !apiToken) {
      throw new Error("JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN are required");
    }

    return { baseUrl, email, apiToken, defaultProject };
  }

  async createIssue(
    task: ExtractedTaskRow,
    project?: string
  ): Promise<IssueCreateResult & { refinedTitle: string }> {
    if (task.approval_status !== "approved") {
      throw new Error("Task must be approved before Jira creation");
    }

    const config = this.getConfig();
    const projectKey = project || config.defaultProject;
    const issueLog = log.child({ taskId: task.id, project: projectKey });

    const requirements = await refineRequirements(task);

    let assigneeAccountId: string | undefined;
    if (requirements.assignee?.email) {
      assigneeAccountId = await this.lookupAccountId(config, requirements.assignee.email);
    }

    const description = buildRequirementsAdf(requirements);

    const payload: Record<string, unknown> = {
      fields: {
        project: { key: projectKey },
        summary: requirements.title,
        description,
        issuetype: { name: await this.resolveIssueType(config, projectKey, requirements.issueType) },
        priority: { name: mapPriority(requirements.priority) },
        labels: requirements.labels,
      },
    };

    if (assigneeAccountId) {
      (payload.fields as Record<string, unknown>).assignee = {
        accountId: assigneeAccountId,
      };
    }

    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD;
    if (requirements.storyPoints && storyPointsField) {
      (payload.fields as Record<string, unknown>)[storyPointsField] =
        Number(requirements.storyPoints);
    }

    issueLog.info({ summary: requirements.title }, "Creating Jira issue from refined requirements");

    const response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: this.headers(config),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      issueLog.error({ status: response.status, body: errorBody }, "Jira issue creation failed");
      throw new Error(`Jira API error ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as { key: string; self: string };
    const issueUrl = `${config.baseUrl}/browse/${result.key}`;

    // Add watchers for additional assignees
    const watchedEmails = new Set<string>();
    if (requirements.assignee?.email) watchedEmails.add(requirements.assignee.email.toLowerCase());

    if (task.inferred_assignees?.length > 1) {
      for (const assignee of task.inferred_assignees.slice(1)) {
        if (assignee.email && !watchedEmails.has(assignee.email.toLowerCase())) {
          watchedEmails.add(assignee.email.toLowerCase());
          const watcherAccountId = await this.lookupAccountId(config, assignee.email);
          if (watcherAccountId) {
            await this.addWatcher(config, result.key, watcherAccountId).catch((err) =>
              issueLog.warn({ err, email: assignee.email }, "Failed to add watcher")
            );
          }
        }
      }
    }

    // Add meeting participants as watchers
    const { data: transcript } = await supabaseAdmin
      .from("transcripts")
      .select("attendees")
      .eq("id", task.transcript_id)
      .single();

    if (transcript?.attendees) {
      for (const attendee of transcript.attendees as Array<{ name: string; email?: string }>) {
        if (attendee.email && !watchedEmails.has(attendee.email.toLowerCase())) {
          watchedEmails.add(attendee.email.toLowerCase());
          const watcherAccountId = await this.lookupAccountId(config, attendee.email);
          if (watcherAccountId) {
            await this.addWatcher(config, result.key, watcherAccountId).catch((err) =>
              issueLog.warn({ err, email: attendee.email }, "Failed to add meeting participant watcher")
            );
          }
        }
      }
    }

    issueLog.info(
      { issueKey: result.key, issueUrl, issueType: requirements.issueType, storyPoints: requirements.storyPoints },
      "Jira issue created from requirements"
    );

    await supabaseAdmin
      .from("extracted_tasks")
      .update({ tracker_issue_key: result.key })
      .eq("id", task.id);

    return { issueKey: result.key, issueUrl, refinedTitle: requirements.title };
  }

  async checkForDuplicates(
    title: string,
    project: string,
    lookbackDays: number = 14
  ): Promise<Array<{ key: string; summary: string; similarity: number }>> {
    const config = this.getConfig();

    const jql = `project = ${project} AND created >= -${lookbackDays}d ORDER BY created DESC`;
    const response = await fetch(
      `${config.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=50`,
      { headers: this.headers(config) }
    );

    if (!response.ok) return [];

    const data = (await response.json()) as {
      issues: Array<{ key: string; fields: { summary: string } }>;
    };

    const normalizedTitle = normalizeString(title);
    const duplicates: Array<{ key: string; summary: string; similarity: number }> = [];

    for (const issue of data.issues) {
      const similarity = levenshteinSimilarity(
        normalizedTitle,
        normalizeString(issue.fields.summary)
      );
      if (similarity > 0.7) {
        duplicates.push({ key: issue.key, summary: issue.fields.summary, similarity });
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  async retryFailedIssue(taskId: string): Promise<IssueCreateResult> {
    const { data: task, error } = await supabaseAdmin
      .from("extracted_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (error || !task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== "jira_failed") {
      throw new Error(`Task ${taskId} is not in jira_failed status`);
    }
    if (task.approval_status !== "approved") {
      throw new Error("Task must be approved before Jira retry");
    }

    await supabaseAdmin
      .from("extracted_tasks")
      .update({ tracker_error: null })
      .eq("id", taskId);

    return this.createIssue(task);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private headers(config: JiraConfig): Record<string, string> {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async lookupAccountId(config: JiraConfig, email: string): Promise<string | undefined> {
    try {
      const response = await fetch(
        `${config.baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(email)}`,
        { headers: this.headers(config) }
      );
      if (!response.ok) return undefined;
      const users = (await response.json()) as Array<{ accountId: string }>;
      return users[0]?.accountId;
    } catch (err) {
      log.warn({ err, email }, "Failed to look up Jira account");
      return undefined;
    }
  }

  private async addWatcher(config: JiraConfig, issueKey: string, accountId: string): Promise<void> {
    await fetch(`${config.baseUrl}/rest/api/3/issue/${issueKey}/watchers`, {
      method: "POST",
      headers: this.headers(config),
      body: JSON.stringify(accountId),
    });
  }

  private async resolveIssueType(config: JiraConfig, project: string, requested: string): Promise<string> {
    let validTypes = this._projectIssueTypes.get(project);
    if (!validTypes) {
      try {
        const res = await fetch(
          `${config.baseUrl}/rest/api/3/project/${project}`,
          { headers: this.headers(config) }
        );
        if (res.ok) {
          const data = await res.json() as { issueTypes?: Array<{ name: string }> };
          validTypes = new Set((data.issueTypes ?? []).map((t) => t.name));
          this._projectIssueTypes.set(project, validTypes);
        }
      } catch {
        // If we can't fetch, try the requested type anyway
      }
    }

    if (validTypes && !validTypes.has(requested)) {
      const fallback = validTypes.has("Task") ? "Task" : validTypes.values().next().value ?? "Task";
      log.warn(
        { requested, fallback, project, available: [...(validTypes ?? [])] },
        "Requested issue type not available in project, using fallback"
      );
      return fallback;
    }

    return requested;
  }
}

// Re-export helpers for backward compatibility with existing tests
export { buildRequirementsAdf, buildLegacyAdf, mapPriority, normalizeString, levenshteinSimilarity, levenshteinDistance } from "./jira-helpers";
