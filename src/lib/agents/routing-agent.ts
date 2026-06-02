import { generateText, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { previewLearningRouting } from "@/lib/learning/routing";
import { routingOutputSchema } from "./schemas";
import type { ExtractedTaskRow } from "@/lib/types";

const log = logger.child({ service: "routing-agent" });

const ROUTING_INSTRUCTIONS = `You are a task router. Given a task extracted from a meeting transcript and a list of Jira projects with descriptions, select the single best project for this task.

Rules:
- Match based on the task's title, description, labels, and priority against each project's routing description.
- If a project is marked as default, choose it when no other project is a strong match.
- Return the exact projectKey from the list. Do not invent new keys.
- Keep reasoning to one sentence.`;

export interface ProjectRoute {
  projectKey: string;
  name: string;
  routingPrompt: string;
  isDefault?: boolean;
}

/**
 * Determine which Jira project a task should be created in.
 *
 * Resolution order:
 * 1. Already-persisted jira_project on the task row (avoids re-routing on retry)
 * 2. Claude routing agent (when multiple routes are configured)
 * 3. Single configured route / env default fallback
 */
export async function routeTaskToProject(
  task: ExtractedTaskRow
): Promise<string> {
  if (task.tracker_project) {
    log.debug({ taskId: task.id, project: task.tracker_project }, "Using cached routing decision");
    await previewLearningRouting(task, { persist: true, fallbackProjectKey: task.tracker_project }).catch(() => null);
    return task.tracker_project;
  }

  const routes = await fetchProjectRoutes();
  const envDefault = process.env.JIRA_DEFAULT_PROJECT || "SCRUM";

  if (routes.length === 0) {
    await previewLearningRouting(task, { persist: true, fallbackProjectKey: envDefault }).catch(() => null);
    await persistRouting(task.id, envDefault);
    return envDefault;
  }

  if (routes.length === 1) {
    const key = routes[0].projectKey;
    const learned = await previewLearningRouting(task, { persist: true, fallbackProjectKey: key }).catch(() => null);
    if (learned?.projectKey && !learned.needsReview) {
      await persistRouting(task.id, learned.projectKey);
      return learned.projectKey;
    }
    await persistRouting(task.id, key);
    return key;
  }

  const defaultRoute = routes.find((r) => r.isDefault);
  const fallback = defaultRoute?.projectKey ?? routes[0].projectKey;

  const learned = await previewLearningRouting(task, { persist: true, fallbackProjectKey: fallback }).catch(() => null);
  if (learned?.projectKey && !learned.needsReview && ["memory", "project_mapping", "repo_catalog"].includes(learned.source)) {
    await persistRouting(task.id, learned.projectKey);
    return learned.projectKey;
  }

  const projectKey = await callRoutingAgent(task, routes, fallback);
  await previewLearningRouting(task, { persist: true, fallbackProjectKey: projectKey }).catch(() => null);
  await persistRouting(task.id, projectKey);
  return projectKey;
}

async function fetchProjectRoutes(): Promise<ProjectRoute[]> {
  const { data } = await supabaseAdmin
    .from("pipeline_config")
    .select("value")
    .eq("key", "project_routes")
    .single();

  if (!data?.value) return [];

  try {
    const parsed = typeof data.value === "string"
      ? JSON.parse(data.value)
      : data.value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    log.warn("Failed to parse project_routes config");
    return [];
  }
}

async function callRoutingAgent(
  task: ExtractedTaskRow,
  routes: ProjectRoute[],
  fallback: string
): Promise<string> {
  const projectList = routes
    .map(
      (r) =>
        `- **${r.projectKey}** (${r.name})${r.isDefault ? " [DEFAULT]" : ""}: ${r.routingPrompt}`
    )
    .join("\n");

  const prompt = `## Task
**Title:** ${task.extracted_title}
**Description:** ${task.extracted_description}
**Priority:** ${task.priority}
**Labels:** ${(task.labels || []).join(", ") || "none"}
**Confidence:** ${task.confidence}

## Available Projects
${projectList}

Select the best project for this task.`;

  log.info({ taskId: task.id }, "Routing task to Jira project via Claude");

  try {
    const { output } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: ROUTING_INSTRUCTIONS,
      prompt,
      output: Output.object({ schema: routingOutputSchema }),
    });

    if (!output) {
      log.warn({ taskId: task.id }, "Routing agent returned no output, using fallback");
      return fallback;
    }

    const validKeys = new Set(routes.map((r) => r.projectKey));
    if (!validKeys.has(output.projectKey)) {
      log.warn(
        { taskId: task.id, returned: output.projectKey },
        "Routing agent returned invalid project key, using fallback"
      );
      return fallback;
    }

    log.info(
      { taskId: task.id, projectKey: output.projectKey, reasoning: output.reasoning },
      "Task routed"
    );

    return output.projectKey;
  } catch (err) {
    log.error({ err, taskId: task.id }, "Routing agent failed, using fallback");
    return fallback;
  }
}

async function persistRouting(taskId: string, projectKey: string): Promise<void> {
  await supabaseAdmin
    .from("extracted_tasks")
    .update({ tracker_project: projectKey })
    .eq("id", taskId);
}
