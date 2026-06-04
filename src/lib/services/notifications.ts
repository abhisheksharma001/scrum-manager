import { logger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";
import type { ExtractedTaskRow, TranscriptRow } from "@/lib/types";

const log = logger.child({ service: "notifications" });

// ─── Types ──────────────────────────────────────────────────────────────────

export type NotificationType =
  | "interview_needed"
  | "claim_expiring"
  | "interview_completed"
  | "auto_pushed"
  | "push_failed";

interface CreateNotification {
  userId?: string | null; // null = broadcast to all users
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

// ─── Core: write to DB + fire Slack ─────────────────────────────────────────

/**
 * Create an in-app notification and optionally send to Slack.
 */
export async function notify(
  notification: CreateNotification,
  options?: { slack?: boolean; slackBlocks?: unknown[] }
): Promise<void> {
  const { userId, type, title, body, link, metadata } = notification;

  // 1. Write to database
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: userId ?? null,
      type,
      title,
      body: body ?? "",
      link: link ?? null,
      metadata: metadata ?? {},
    });
  } catch (err) {
    log.error({ err, type, title }, "Failed to insert notification");
  }

  // 2. Slack (optional)
  if (options?.slack !== false) {
    await sendSlack(options?.slackBlocks ?? buildDefaultSlackBlocks(notification));
  }
}

/**
 * Broadcast a notification to all users.
 */
export async function notifyAll(
  notification: Omit<CreateNotification, "userId">,
  options?: { slack?: boolean; slackBlocks?: unknown[] }
): Promise<void> {
  await notify({ ...notification, userId: null }, options);
}

// ─── Trigger Functions ──────────────────────────────────────────────────────

/**
 * Notify when new tasks need human interview.
 */
export async function notifyNewInterviews(
  transcript: TranscriptRow,
  tasks: ExtractedTaskRow[]
): Promise<void> {
  const interviewTasks = tasks.filter(
    (t) => t.status === "pending_interview"
  );
  if (interviewTasks.length === 0) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const count = interviewTasks.length;

  await notifyAll(
    {
      type: "interview_needed",
      title: `${count} task${count > 1 ? "s" : ""} need${count === 1 ? "s" : ""} interview`,
      body: `From "${transcript.meeting_title}" — ${interviewTasks.map((t) => t.extracted_title).join(", ")}`,
      link: "/interviews",
      metadata: {
        transcriptId: transcript.id,
        taskIds: interviewTasks.map((t) => t.id),
        meetingTitle: transcript.meeting_title,
      },
    },
    {
      slackBlocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🎙️ New interviews from: ${transcript.meeting_title}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${count}* task(s) need human input from the meeting on ${new Date(transcript.meeting_date).toLocaleDateString()}.`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: interviewTasks
              .map((t) => {
                const si = t.suggested_interviewer;
                const interviewerNote = si ? ` → suggested: *${si.name}*` : "";
                return `• *${t.extracted_title}* (${t.confidence} confidence, ${t.priority})${interviewerNote}`;
              })
              .join("\n"),
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open Interview Queue" },
              url: `${appUrl}/interviews`,
              style: "primary",
            },
          ],
        },
      ],
    }
  );
}

/**
 * Notify when approved tasks are pushed to Jira.
 */
export async function notifyAutoCreatedTasks(
  transcript: TranscriptRow,
  tasks: Array<{ title: string; jiraKey: string }>
): Promise<void> {
  const jiraBaseUrl = process.env.JIRA_BASE_URL || "";

  await notifyAll(
    {
      type: "auto_pushed",
      title: `${tasks.length} approved task${tasks.length > 1 ? "s" : ""} pushed to Jira`,
      body: tasks.map((t) => `${t.jiraKey}: ${t.title}`).join(", "),
      link: "/tasks",
      metadata: {
        transcriptId: transcript.id,
        meetingTitle: transcript.meeting_title,
        issues: tasks,
      },
    },
    {
      slackBlocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🚀 Approved tasks pushed from: ${transcript.meeting_title}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: tasks
              .map(
                (t) =>
                  `• <${jiraBaseUrl}/browse/${t.jiraKey}|${t.jiraKey}>: ${t.title}`
              )
              .join("\n"),
          },
        },
      ],
    }
  );
}

/**
 * Notify when a Jira push fails.
 */
export async function notifyPushFailed(
  taskId: string,
  taskTitle: string,
  errorMessage: string
): Promise<void> {
  await notifyAll(
    {
      type: "push_failed",
      title: "Jira push failed",
      body: `"${taskTitle}" — ${errorMessage}`,
      link: "/tasks",
      metadata: { taskId, error: errorMessage },
    },
    {
      slackBlocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "❌ Jira push failed" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${taskTitle}*\n\`\`\`${errorMessage}\`\`\``,
          },
        },
      ],
    }
  );
}

/**
 * Notify when an interview is completed and task is ready for review.
 */
export async function notifyInterviewCompleted(
  taskId: string,
  taskTitle: string,
  completedBy: string
): Promise<void> {
  await notifyAll(
    {
      type: "interview_completed",
      title: "Interview completed",
      body: `"${taskTitle}" reviewed by ${completedBy} — ready for Jira`,
      link: "/tasks",
      metadata: { taskId, completedBy },
    },
    {
      slackBlocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "✅ Interview completed" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${taskTitle}* was reviewed by *${completedBy}* and is ready to push.`,
          },
        },
      ],
    }
  );
}

/**
 * Notify when a claim is about to expire.
 */
export async function notifyClaimExpiring(
  userId: string,
  taskId: string,
  taskTitle: string
): Promise<void> {
  await notify(
    {
      userId,
      type: "claim_expiring",
      title: "Interview claim expiring soon",
      body: `Your claim on "${taskTitle}" expires in 5 minutes`,
      link: "/interviews",
      metadata: { taskId },
    },
    { slack: false } // Personal notification, no Slack
  );
}

// ─── Slack Helpers ──────────────────────────────────────────────────────────

function buildDefaultSlackBlocks(n: CreateNotification): unknown[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${n.title}*${n.body ? `\n${n.body}` : ""}`,
      },
    },
  ];
}

async function sendSlack(blocks: unknown[]): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      log.error({ status: response.status }, "Failed to send Slack notification");
    }
  } catch (err) {
    log.error({ err }, "Error sending Slack notification");
  }
}
