import { enqueueJiraCreation, enqueueRepoAnalysis, enqueueBriefDelivery } from "./queue";
import type {
  TranscriptProcessingJob,
  JiraCreationJob,
  MaintenanceJob,
  RepoAnalysisJob,
  BriefDeliveryJob,
} from "./queue";
import { extractTasks, storeAndRouteExtractedTasks } from "@/lib/services/extraction";
import { updateTranscriptStatus, getTranscript } from "@/lib/services/ingestion";
import { getIssueTracker } from "@/lib/issue-tracker";
import { routeTaskToProject } from "@/lib/agents/routing-agent";
import { expireStaleClaims, expireOldInterviews } from "@/lib/services/interview-queue";
import {
  notifyNewInterviews,
  notifyAutoCreatedTasks,
  notifyPushFailed,
  notify,
} from "@/lib/services/notifications";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { createBrief, setBriefStatus, getBrief } from "@/lib/services/developer-brief";
import { analyzeBrief } from "@/lib/services/repo-analysis";
import { renderBriefPlainText } from "@/lib/services/brief-renderer";
import { markTaskAwaitingApproval, shouldAnalyzeRepo, shouldInterviewTask } from "@/lib/services/task-readiness";
import type { NormalizedTranscript, TranscriptProvider } from "@/lib/types";
import type { DeveloperBrief } from "@/lib/types";

const log = logger.child({ service: "worker" });

function classifyRepoAnalysisError(errorMessage: string): string {
  if (
    errorMessage.includes("GitHub API error 401") ||
    errorMessage.includes("GitHub API error 403") ||
    errorMessage.includes("Repo not allowlisted") ||
    errorMessage.includes("GITHUB_READONLY_TOKEN")
  ) {
    return "github_access_denied";
  }
  return "generation_failed";
}

async function sendBriefSlackMessage(payload: {
  title: string;
  trackerKey: string | null;
  trackerUrl: string | null;
  briefUrl: string;
}): Promise<string | null> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return "SLACK_WEBHOOK_URL is not configured";
  }

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `Developer prompt pack ready: ${payload.title}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: payload.trackerKey && payload.trackerUrl
          ? `Tracker: <${payload.trackerUrl}|${payload.trackerKey}>\nIncludes implementation logic and a copy-paste Codex / Claude Code prompt.`
          : "Tracker: N/A\nIncludes implementation logic and a copy-paste Codex / Claude Code prompt.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open Prompt Pack" },
          url: payload.briefUrl,
          style: "primary",
        },
      ],
    },
  ];

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    return `Slack webhook failed with status ${response.status}`;
  }
  return null;
}

async function addJiraBriefComment(input: {
  issueKey: string;
  trackerUrl: string | null;
  brief: DeveloperBrief;
}): Promise<string | null> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    return "Jira credentials are not configured for comment delivery";
  }

  const lines = renderBriefPlainText(input.brief, input.trackerUrl).split("\n");

  const adf = {
    type: "doc",
    version: 1,
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const response = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/comment`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ body: adf }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return `Jira comment failed with status ${response.status}${body ? `: ${body}` : ""}`;
  }
  return null;
}

function safeParseConfig<T>(value: unknown, fallback: T): T {
  try {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string") return JSON.parse(value) as T;
    return value as T;
  } catch {
    log.warn({ value }, "Failed to parse config value, using fallback");
    return fallback;
  }
}

/**
 * Process a transcript: extract tasks via Claude, then route to interviews, repo analysis,
 * or approval. Jira creation is approval-gated and is never triggered here.
 */
export async function processTranscript(data: TranscriptProcessingJob) {
  const { transcriptId, provider, meetingTitle, meetingDate, attendees, duration, utterances } = data;
  const jobLog = log.child({ transcriptId });

  jobLog.info("Starting transcript processing");
  await updateTranscriptStatus(transcriptId, "processing");

  try {
    const transcript: NormalizedTranscript = {
      provider: provider as TranscriptProvider,
      externalId: data.externalId,
      meetingTitle,
      meetingDate: new Date(meetingDate),
      duration,
      attendees,
      utterances,
      rawFormat: "json",
      metadata: {},
    };

    const result = await extractTasks(transcript, transcriptId);

    if (result.tasks.length === 0) {
      jobLog.info("No tasks extracted from transcript");
      await updateTranscriptStatus(transcriptId, "completed");
      return;
    }

    const { data: configRow } = await supabaseAdmin
      .from("pipeline_config")
      .select("value")
      .eq("key", "confidence_auto_create_threshold")
      .single();

    const autoCreateThreshold = safeParseConfig<string[]>(configRow?.value, ["high"]);
    const taskIds = await storeAndRouteExtractedTasks(result, autoCreateThreshold);

    if (taskIds.length === 0) {
      jobLog.warn("No tasks were stored after extraction");
      await updateTranscriptStatus(transcriptId, "completed");
      return;
    }

    const { data: storedTasks, error: fetchError } = await supabaseAdmin
      .from("extracted_tasks")
      .select("*")
      .in("id", taskIds);

    if (fetchError) {
      jobLog.error({ error: fetchError }, "Failed to fetch stored tasks");
      throw new Error(`Failed to fetch stored tasks: ${fetchError.message}`);
    }

    if (storedTasks && storedTasks.length > 0) {
      const repoTasks = storedTasks.filter((t) => !shouldInterviewTask(t) && shouldAnalyzeRepo(t));
      for (const task of repoTasks) {
        const resolvedProject = task.tracker_project || await routeTaskToProject(task);
        await supabaseAdmin
          .from("extracted_tasks")
          .update({
            status: "pending_repo_analysis",
            approval_status: "not_ready",
            tracker_project: resolvedProject,
          })
          .eq("id", task.id);
        task.tracker_project = resolvedProject;
        const brief = await createBrief(task.id, null);
        await enqueueRepoAnalysis({ briefId: brief.id });
      }

      const approvalTasks = storedTasks.filter((t) => !shouldInterviewTask(t) && !shouldAnalyzeRepo(t));
      for (const task of approvalTasks) {
        if (!task.tracker_project) {
          const resolvedProject = await routeTaskToProject(task);
          await supabaseAdmin
            .from("extracted_tasks")
            .update({ tracker_project: resolvedProject })
            .eq("id", task.id);
        }
        await markTaskAwaitingApproval(task.id);
      }

      const transcriptRow = await getTranscript(transcriptId);
      if (transcriptRow) {
        const interviewTasks = storedTasks.filter(
          (t) => t.status === "pending_interview"
        );
        if (interviewTasks.length > 0) {
          await notifyNewInterviews(transcriptRow, interviewTasks);
        }
      }
    }

    await updateTranscriptStatus(transcriptId, "completed");
    jobLog.info(
      { taskCount: result.tasks.length, processingTimeMs: result.processingTimeMs },
      "Transcript processing complete"
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    jobLog.error({ err }, "Transcript processing failed");
    await updateTranscriptStatus(transcriptId, "failed", errorMessage);
    throw err;
  }
}

/**
 * Create a Jira issue for an approved extracted task.
 */
export async function processJiraCreation(data: JiraCreationJob) {
  const { taskId, projectKey } = data;
  const jobLog = log.child({ taskId });

  jobLog.info("Creating Jira issue");

  const { data: task, error } = await supabaseAdmin
    .from("extracted_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (error || !task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.approval_status !== "approved") {
    throw new Error("Task must be approved before Jira creation");
  }

  try {
    const resolvedProject = projectKey || await routeTaskToProject(task);
    const result = await getIssueTracker().createIssue(task, resolvedProject);
    await supabaseAdmin
      .from("extracted_tasks")
      .update({
        status: "jira_created",
        approval_status: "approved",
        tracker_issue_key: result.issueKey,
        tracker_error: null,
      })
      .eq("id", task.id);
    jobLog.info({ issueKey: result.issueKey, project: resolvedProject }, "Jira issue created");

    try {
      const { data: existingBrief } = await supabaseAdmin
        .from("developer_briefs")
        .select("id")
        .eq("task_id", task.id)
        .maybeSingle();
      if (existingBrief?.id) {
        await setBriefStatus(existingBrief.id, "sending", { tracker_issue_key: result.issueKey });
        await enqueueBriefDelivery({ briefId: existingBrief.id });
      }
    } catch (briefErr) {
      jobLog.warn({ err: briefErr }, "Jira issue created, but developer delivery setup failed");
    }

    const transcript = await getTranscript(task.transcript_id);
    if (transcript) {
      await notifyAutoCreatedTasks(transcript, [
        { title: result.refinedTitle, jiraKey: result.issueKey },
      ]);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    jobLog.error({ err }, "Jira creation failed");

    await supabaseAdmin
      .from("extracted_tasks")
      .update({ status: "jira_failed", tracker_error: errorMessage })
      .eq("id", taskId);
    await supabaseAdmin
      .from("developer_briefs")
      .update({
        status: "failed",
        error_code: "jira_creation_failed",
        error_detail: errorMessage,
      })
      .eq("task_id", taskId);

    await notifyPushFailed(taskId, task.extracted_title, errorMessage);
    throw err;
  }
}

export async function processRepoAnalysis(data: RepoAnalysisJob) {
  try {
    await analyzeBrief(data.briefId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setBriefStatus(data.briefId, "failed", {
      error_code: classifyRepoAnalysisError(message),
      error_detail: message,
    });
  }
}

export async function processBriefDelivery(data: BriefDeliveryJob) {
  const brief = await getBrief(data.briefId);
  const { data: task } = await supabaseAdmin.from("extracted_tasks").select("*").eq("id", brief.task_id).single();
  if (!task || !brief.brief) throw new Error("Brief delivery context missing");

  const trackerUrl = task.tracker_issue_key ? `${process.env.JIRA_BASE_URL}/browse/${task.tracker_issue_key}` : null;
  const errors: string[] = [];
  const delivery: Record<string, unknown> = {};

  if (!task.tracker_issue_key) {
    errors.push("Task does not have a tracker issue key for comment delivery");
  } else {
    const jiraError = await addJiraBriefComment({
      issueKey: task.tracker_issue_key,
      trackerUrl,
      brief: brief.brief,
    });
    if (jiraError) {
      errors.push(jiraError);
      delivery.jira = "failed";
    } else {
      delivery.jira = "sent";
    }
  }

  try {
    const { sendBriefEmail } = await import("@/lib/services/email");
    await sendBriefEmail({
      to: task.assigned_developer_email ?? task.inferred_assignees?.[0]?.email,
      subject: `Developer prompt pack: ${task.extracted_title}`,
      brief: brief.brief,
      trackerUrl,
    });
    delivery.email = (task.assigned_developer_email ?? task.inferred_assignees?.[0]?.email) ? "sent" : "skipped_no_recipient";
  } catch (err) {
    errors.push(`Email delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    delivery.email = "failed";
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const slackError = await sendBriefSlackMessage({
    title: task.extracted_title,
    trackerKey: task.tracker_issue_key ?? null,
    trackerUrl,
    briefUrl: `${appUrl}/briefs`,
  });
  if (slackError) {
    errors.push(slackError);
    delivery.slack = "failed";
  } else {
    delivery.slack = "sent";
  }

  await notify(
    {
      type: "auto_pushed",
      title: `Developer prompt pack ready: ${task.extracted_title}`,
      body: `Tracker: ${task.tracker_issue_key ?? "N/A"}`,
      link: `/briefs`,
      metadata: { briefId: brief.id, delivery },
    },
    { slack: false }
  );

  await setBriefStatus(brief.id, errors.length > 0 ? "failed" : "sent", {
    error_code: errors.length > 0 ? "delivery_failed" : null,
    error_detail: errors.length > 0 ? errors.join(" | ") : null,
    delivery,
  });
}

/**
 * Run maintenance tasks (claim expiry, interview expiry).
 */
export async function processMaintenance(data: MaintenanceJob) {
  switch (data.type) {
    case "expire-claims": {
      const count = await expireStaleClaims();
      log.info({ count }, "Maintenance: expired stale claims");
      break;
    }
    case "expire-interviews": {
      const { data: configRow } = await supabaseAdmin
        .from("pipeline_config")
        .select("value")
        .eq("key", "interview_expiry_hours")
        .single();

      const expiryHours = safeParseConfig<number>(configRow?.value, 72);
      const count = await expireOldInterviews(expiryHours);
      log.info({ count, expiryHours }, "Maintenance: expired old interviews");
      break;
    }
  }
}
