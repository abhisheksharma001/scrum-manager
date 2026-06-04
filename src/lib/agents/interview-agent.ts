import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { interviewCompletionSchema } from "./schemas";
import type { InterviewCompletion } from "./schemas";
import type { ExtractedTaskRow, Priority } from "@/lib/types";
import { inferWorkType } from "@/lib/services/task-readiness";

const log = logger.child({ service: "interview-agent" });

const MAX_TRANSCRIPT_LENGTH = 100_000;

const INTERVIEWER_INSTRUCTIONS = `You are an AI interviewer gathering missing context for a task extracted from a meeting transcript. Your goal is to have a short, focused conversation with a team member to fill in the gaps.

Rules:
- Be conversational but efficient. Don't waste the person's time.
- Ask one question at a time (you may combine two very short related questions).
- Use the transcript context to ask smart, specific questions — not generic ones.
- If the person's answer implies something about other missing context, don't re-ask what's already clear.
- When you have enough information to create a good task, call the complete_interview tool.
- Keep the whole interview under 5-6 exchanges.
- If the person tells you this isn't a real task or it's already been handled, call complete_interview with should_create set to false and a brief reason in the description.
- Do NOT call complete_interview until you're confident you have enough context. Ask questions first.`;

export interface InterviewMessage {
  role: "assistant" | "user";
  content: string;
}

/**
 * Builds interview context from DB — never accept from the client.
 * This prevents prompt-injection via a spoofed context payload.
 */
function buildInterviewContext(
  task: Record<string, unknown>,
  transcript: Record<string, unknown>
): string {
  const missingContext = (task.missing_context || []) as string[];
  const assignees = (
    (task.inferred_assignees || []) as Array<{ name: string }>
  )
    .map((a) => a.name)
    .join(", ");

  let fullText =
    (transcript.full_text as string) || "(Transcript text not stored)";
  if (fullText.length > MAX_TRANSCRIPT_LENGTH) {
    fullText =
      fullText.slice(0, MAX_TRANSCRIPT_LENGTH) + "\n\n[Transcript truncated]";
  }

  return `## Task Extracted from Meeting
**Title:** ${task.extracted_title}
**Description:** ${task.extracted_description}
**Confidence:** ${task.confidence}
**Inferred assignee(s):** ${assignees || "Unknown"}
**Priority guess:** ${task.priority}

## What's Missing
${missingContext.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n")}

## Source Quotes
${((task.source_quotes || []) as Array<{ text: string }>).map((q) => `> "${q.text}"`).join("\n") || "None captured"}

## Meeting Info
**Meeting:** ${transcript.meeting_title} (${new Date(transcript.meeting_date as string).toLocaleDateString()})
**Attendees:** ${((transcript.attendees || []) as Array<{ name: string }>).map((a) => a.name).join(", ")}

## Full Transcript
${fullText}`;
}

/**
 * Start an AI interview — generates the first question based on task context.
 * Context is built server-side and never exposed to the client.
 */
export async function startAIInterview(
  taskId: string
): Promise<{ message: string }> {
  const { task, transcript } = await loadTaskWithTranscript(taskId);
  const context = buildInterviewContext(task, transcript);

  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: INTERVIEWER_INSTRUCTIONS,
    messages: [
      {
        role: "user",
        content: `Here's the context for this interview. Generate your first question for the team member.\n\n${context}`,
      },
    ],
    maxOutputTokens: 512,
  });

  log.info({ taskId }, "AI interview started");
  return { message: text };
}

/**
 * Continue an AI interview with the human's response.
 * Context is reconstructed server-side on every turn.
 */
export async function continueAIInterview(
  taskId: string,
  history: InterviewMessage[]
): Promise<{ message: string; completion: InterviewCompletion | null }> {
  const { task, transcript } = await loadTaskWithTranscript(taskId);
  const context = buildInterviewContext(task, transcript);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `Here's the context for this interview. Generate your first question for the team member.\n\n${context}`,
    },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const completeInterviewTool = tool({
    description:
      "Call this when you have gathered enough context to finalize the task. Provide the refined task details.",
    inputSchema: interviewCompletionSchema,
    execute: async (input) => input,
  });

  const result = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: INTERVIEWER_INSTRUCTIONS,
    messages,
    tools: { complete_interview: completeInterviewTool },
    maxOutputTokens: 1024,
  });

  const toolCall = result.staticToolCalls?.find(
    (tc) => tc.toolName === "complete_interview"
  );

  let completion: InterviewCompletion | null = null;
  if (toolCall) {
    completion = toolCall.input as InterviewCompletion;
    log.info(
      { taskId, shouldCreate: completion.should_create },
      "AI interview completed"
    );
  }

  return { message: result.text, completion };
}

/**
 * Apply the completed interview data to the task.
 */
export async function applyInterviewCompletion(
  taskId: string,
  completion: InterviewCompletion,
  chatHistory: InterviewMessage[]
): Promise<ExtractedTaskRow> {
  const responses: Record<string, string> = {};
  for (let i = 0; i < chatHistory.length; i += 2) {
    const question = chatHistory[i]?.content || `Question ${i / 2 + 1}`;
    const answer = chatHistory[i + 1]?.content || "";
    responses[question] = answer;
  }

  if (!completion.should_create) {
    const query = supabaseAdmin
      .from("extracted_tasks")
      .update({
        status: "dismissed",
        dismissed_reason: completion.description,
        interview_responses: responses,
      })
      .eq("id", taskId) as unknown as {
        select?: (columns: string) => { single: () => Promise<{ data: unknown; error?: unknown }> };
      };
    if (typeof query.select === "function") {
      const { data } = await query.select("*").single();
      return data as ExtractedTaskRow;
    }
    return { id: taskId, status: "dismissed" } as ExtractedTaskRow;
  }

  const workType = completion.workType ?? inferWorkType(
    completion.labels,
    `${completion.title} ${completion.description}`
  );
  const repoContextNeeded = workType === "code" || Boolean(completion.repoNames?.length);
  const updates = {
    status: repoContextNeeded ? "pending_repo_analysis" : "awaiting_approval",
    approval_status: repoContextNeeded ? "not_ready" : "awaiting_approval",
    extracted_title: completion.title,
    extracted_description: completion.description,
    inferred_assignees: completion.assignee
      ? [{ name: completion.assignee, email: completion.developerEmail ?? undefined }]
      : undefined,
    assigned_developer_name: completion.assignee,
    assigned_developer_email: completion.developerEmail ?? null,
    tracker_project: completion.projectKey ?? undefined,
    work_type: workType,
    repo_context_needed: repoContextNeeded,
    priority: completion.priority as Priority,
    labels: completion.labels,
    interview_responses: responses,
  };
  const query = supabaseAdmin
    .from("extracted_tasks")
    .update(updates)
    .eq("id", taskId) as unknown as {
      select?: (columns: string) => { single: () => Promise<{ data: unknown; error?: unknown }> };
    };
  if (typeof query.select === "function") {
    const { data, error } = await query.select("*").single();
    if (error || !data) throw error ?? new Error("Failed to apply interview completion");
    return data as ExtractedTaskRow;
  }
  return { id: taskId, ...updates } as ExtractedTaskRow;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadTaskWithTranscript(taskId: string) {
  const { data: task, error: taskError } = await supabaseAdmin
    .from("extracted_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (taskError || !task) throw new Error(`Task not found: ${taskId}`);

  const { data: transcript, error: txError } = await supabaseAdmin
    .from("transcripts")
    .select("*")
    .eq("id", task.transcript_id)
    .single();

  if (txError || !transcript)
    throw new Error(`Transcript not found for task: ${taskId}`);

  return { task, transcript };
}
