import { generateText, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { extractionOutputSchema } from "./schemas";
import type { ExtractionOutput } from "./schemas";
import type {
  NormalizedTranscript,
  ExtractedTask,
  ExtractionResult,
} from "@/lib/types";
import { inferWorkType } from "@/lib/services/task-readiness";

const log = logger.child({ service: "extraction-agent" });

const EXTRACTION_INSTRUCTIONS = `You are a meeting action item extractor. Analyze the meeting transcript below and extract all action items, tasks, and commitments discussed.

For each task, provide:
- title: A concise, actionable title (imperative mood, e.g., "Ship AppFolio webhook integration")
- description: Full context from the discussion — what, why, constraints, and who discussed it
- inferredAssignees: Array of people who should own this. Match speaker names to the Attendees list to include emails when possible. For multi-person tasks, include all people mentioned.
- confidence: "high" | "medium" | "low"
  - high: Clear owner, specific deliverable, timeline mentioned (e.g., "Sean will ship the webhook by Friday")
  - medium: Action discussed but owner or scope is ambiguous (e.g., "Someone should look into the latency issue")
  - low: Vague reference to future work, no clear owner or deliverable (e.g., "We should think about scaling")
- workType: "code" | "non_code" | "unclear"
  - code: software implementation, bug fix, infrastructure, API, frontend, backend, database, integration, tests, deployment, repo/code references
  - non_code: planning, customer follow-up, scheduling, business/admin work, or non-implementation documentation
  - unclear: the project or task intent is too ambiguous to know whether code/repo context is needed
- repoContextNeeded: true when GitHub/repository code context should be inspected before approval; false for clearly non-code tasks
- missingContext: Array of specific questions you couldn't answer from the transcript. Be precise — these will be asked to a human.
  Examples: "Who should own this?", "What's the deadline?", "Which service is affected?", "Is this blocked on anything?"
- sourceQuotes: Array of relevant excerpts from the transcript with approximate timestamps and the speaker name. Include the most relevant 1-3 quotes.
- priority: "P0" (critical/urgent) | "P1" (high) | "P2" (medium/default) | "P3" (low/nice-to-have)
- labels: Suggested categorization labels (e.g., "backend", "frontend", "infrastructure", "bug", "feature")
- suggestedInterviewer: The meeting participant who discussed this task most and would be best suited to answer follow-up questions if clarification is needed. Include their email from the Attendees list if available. Set to null if unclear.

Rules:
- Only extract genuine action items. Skip casual conversation, jokes, and social chat.
- If the same action item is mentioned multiple times, consolidate into a single task with the most complete context.
- Handle noisy transcripts gracefully — speaker misattribution and filler words are common, but pay attention to who proposed, volunteered for, or was assigned each task.
- If a task references ongoing work from a previous meeting (e.g., "still working on X"), skip it unless there's a new action or change in scope.
- Be conservative with "high" confidence — only use it when owner AND deliverable AND timeline are all clear.
- Treat unclear project, unclear repo need, or missing owner as reasons to lower confidence or mark workType as unclear.
- If no action items are found, return an empty tasks array.`;


interface ExistingTask {
  key: string;
  summary: string;
}

export async function extractTasks(
  transcript: NormalizedTranscript,
  transcriptId: string,
  existingJiraTasks?: ExistingTask[]
): Promise<ExtractionResult> {
  const startTime = Date.now();

  const formattedTranscript = formatTranscript(transcript);

  let contextBlock = "";
  if (existingJiraTasks?.length) {
    contextBlock = `\n\nExisting Jira tasks from recent/recurring meetings (skip if already tracked):\n${existingJiraTasks.map((t) => `- ${t.key}: ${t.summary}`).join("\n")}\n`;
  }

  const summaryBlock = transcript.metadata?.summary
    ? `\n--- MEETING SUMMARY ---\n${transcript.metadata.summary}\n--- END SUMMARY ---\n`
    : "";

  const userMessage = `Meeting: ${transcript.meetingTitle}
Date: ${transcript.meetingDate.toISOString()}
Attendees: ${transcript.attendees.map((a) => a.name + (a.email ? ` <${a.email}>` : "")).join(", ")}
Duration: ${Math.round(transcript.duration / 60)} minutes
${contextBlock}${summaryBlock}
--- TRANSCRIPT ---
${formattedTranscript}
--- END TRANSCRIPT ---

Extract all action items.`;

  log.info(
    { transcriptId, utteranceCount: transcript.utterances.length },
    "Starting task extraction"
  );

  const { output } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: EXTRACTION_INSTRUCTIONS,
    prompt: userMessage,
    output: Output.object({ schema: extractionOutputSchema }),
  });

  const extraction = output ?? { tasks: [] };
  const tasks = extraction.tasks.map(mapToExtractedTask);
  const processingTimeMs = Date.now() - startTime;

  log.info(
    { transcriptId, taskCount: tasks.length, processingTimeMs },
    "Task extraction complete"
  );

  return { tasks, transcriptId, processingTimeMs };
}

/** @internal Exported for testing */
export function mapToExtractedTask(
  item: ExtractionOutput["tasks"][number]
): ExtractedTask {
  return {
    title: item.title,
    description: item.description,
    inferredAssignees: item.inferredAssignees.map((a) => ({
      name: a.name,
      email: a.email,
    })),
    confidence: item.confidence,
    workType: item.workType ?? inferWorkType(item.labels, `${item.title} ${item.description}`),
    repoContextNeeded:
      item.repoContextNeeded ?? inferWorkType(item.labels, `${item.title} ${item.description}`) === "code",
    missingContext: item.missingContext,
    sourceQuotes: item.sourceQuotes,
    priority: item.priority,
    labels: item.labels,
    suggestedInterviewer: item.suggestedInterviewer ?? null,
  };
}

/** @internal Exported for testing */
export function formatTranscript(transcript: NormalizedTranscript): string {
  return transcript.utterances
    .map((u) => {
      const timestamp = formatTimestamp(u.startTime);
      return `[${timestamp}] ${u.speaker}: ${u.text}`;
    })
    .join("\n");
}

/** @internal Exported for testing */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Store extracted tasks in Supabase and route them based on confidence.
 */
export async function storeAndRouteExtractedTasks(
  result: ExtractionResult,
  _autoCreateThreshold: string[] = ["high"]
): Promise<string[]> {
  const taskIds: string[] = [];
  const transcriptOwner = await fetchTranscriptOwner(result.transcriptId);

  for (const task of result.tasks) {
    const shouldInterview =
      task.confidence === "low" ||
      task.workType === "unclear" ||
      task.inferredAssignees.length === 0 ||
      task.missingContext.length > 0;
    const status = shouldInterview
      ? "pending_interview"
      : task.repoContextNeeded || task.workType === "code"
        ? "pending_repo_analysis"
        : "awaiting_approval";
    const approvalStatus = status === "awaiting_approval" ? "awaiting_approval" : "not_ready";
    const primaryAssignee = task.inferredAssignees[0] ?? null;

    const { data, error } = await supabaseAdmin
      .from("extracted_tasks")
      .insert({
        transcript_id: result.transcriptId,
        extracted_title: task.title,
        extracted_description: task.description,
        inferred_assignees: task.inferredAssignees,
        confidence: task.confidence,
        work_type: task.workType,
        repo_context_needed: task.repoContextNeeded,
        approval_status: approvalStatus,
        assigned_developer_name: primaryAssignee?.name ?? null,
        assigned_developer_email: primaryAssignee?.email ?? null,
        missing_context: task.missingContext,
        source_quotes: task.sourceQuotes,
        priority: task.priority,
        labels: task.labels,
        suggested_interviewer: task.suggestedInterviewer ?? null,
        owner_user_id: transcriptOwner,
        status,
      })
      .select("id")
      .single();

    if (error) {
      log.error({ error, task: task.title }, "Failed to insert extracted task");
      continue;
    }

    taskIds.push(data.id);
    log.info(
      {
        taskId: data.id,
        title: task.title,
        confidence: task.confidence,
        status,
      },
      "Task stored"
    );
  }

  return taskIds;
}

async function fetchTranscriptOwner(transcriptId: string): Promise<string | null> {
  try {
    const table = supabaseAdmin.from("transcripts") as unknown as {
      select?: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle?: () => Promise<{ data?: { owner_user_id?: string | null } | null }>;
        };
      };
    };
    if (typeof table.select !== "function") return null;
    const query = table.select("owner_user_id").eq("id", transcriptId);
    if (typeof query.maybeSingle !== "function") return null;
    const { data } = await query.maybeSingle();
    return data?.owner_user_id ?? null;
  } catch {
    return null;
  }
}
