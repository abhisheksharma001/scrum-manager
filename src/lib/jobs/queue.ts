import { send } from "@vercel/queue";
import { logger } from "@/lib/logger";

const log = logger.child({ service: "jobs" });

// ─── Redis connection (used only by rate limiter) ────────────────────────────

export function getRedisConnection() {
  const url = process.env.REDIS_URL || process.env.tandem_REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "6379", 10),
      password: parsed.password || undefined,
      tls: parsed.protocol === "rediss:" ? {} : undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
  };
}

// ─── Topic Names ─────────────────────────────────────────────────────────────

export const TOPIC_NAMES = {
  TRANSCRIPT_PROCESSING: "transcript-processing",
  JIRA_CREATION: "jira-creation",
  REPO_ANALYSIS: "repo-analysis",
  BRIEF_DELIVERY: "brief-delivery",
} as const;

// ─── Job Types ───────────────────────────────────────────────────────────────

export interface TranscriptProcessingJob {
  transcriptId: string;
  provider: string;
  externalId: string;
  utterances: Array<{
    speaker: string;
    speakerEmail?: string;
    text: string;
    startTime: number;
    endTime: number;
  }>;
  meetingTitle: string;
  meetingDate: string;
  attendees: Array<{ name: string; email?: string }>;
  duration: number;
}

export interface JiraCreationJob {
  taskId: string;
  projectKey?: string;
  retryCount?: number;
}

export interface MaintenanceJob {
  type: "expire-claims" | "expire-interviews";
}

export interface RepoAnalysisJob {
  briefId: string;
}

export interface BriefDeliveryJob {
  briefId: string;
}

// ─── Job Dispatchers (Vercel Queues) ─────────────────────────────────────────

export async function enqueueTranscriptProcessing(
  data: TranscriptProcessingJob
): Promise<string | null> {
  const { messageId } = await send(TOPIC_NAMES.TRANSCRIPT_PROCESSING, data);
  log.info(
    { messageId, transcriptId: data.transcriptId },
    "Enqueued transcript for processing"
  );
  return messageId;
}

export async function enqueueJiraCreation(
  data: JiraCreationJob
): Promise<string | null> {
  const { messageId } = await send(TOPIC_NAMES.JIRA_CREATION, data);
  log.info(
    { messageId, taskId: data.taskId },
    "Enqueued Jira creation"
  );
  return messageId;
}

export async function enqueueRepoAnalysis(
  data: RepoAnalysisJob
): Promise<string | null> {
  const { messageId } = await send(TOPIC_NAMES.REPO_ANALYSIS, data);
  log.info({ messageId, briefId: data.briefId }, "Enqueued repo analysis");
  return messageId;
}

export async function enqueueBriefDelivery(
  data: BriefDeliveryJob
): Promise<string | null> {
  const { messageId } = await send(TOPIC_NAMES.BRIEF_DELIVERY, data);
  log.info({ messageId, briefId: data.briefId }, "Enqueued brief delivery");
  return messageId;
}
