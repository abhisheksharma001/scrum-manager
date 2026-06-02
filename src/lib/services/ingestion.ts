import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { NormalizedTranscript, TranscriptRow } from "@/lib/types";

const log = logger.child({ service: "ingestion" });

/**
 * Ingest a normalized transcript into Supabase.
 * Deduplicates by (provider, externalId).
 * Returns the transcript row ID, or null if it was a duplicate.
 */
export async function ingestTranscript(
  transcript: NormalizedTranscript,
  options: { ownerUserId?: string | null } = {}
): Promise<{ id: string; isDuplicate: boolean }> {
  // Check for existing transcript
  const { data: existing } = await supabaseAdmin
    .from("transcripts")
    .select("id, status")
    .eq("provider", transcript.provider)
    .eq("external_id", transcript.externalId)
    .single();

  if (existing) {
    log.info(
      { transcriptId: existing.id, provider: transcript.provider },
      "Duplicate transcript detected, skipping"
    );
    return { id: existing.id, isDuplicate: true };
  }

  // Format utterances into readable text for AI interview use
  const fullText = transcript.utterances
    .map((u) => {
      const m = Math.floor(u.startTime / 60);
      const s = Math.floor(u.startTime % 60);
      return `[${m}:${String(s).padStart(2, "0")}] ${u.speaker}: ${u.text}`;
    })
    .join("\n");

  // Insert new transcript
  const { data, error } = await supabaseAdmin
    .from("transcripts")
    .insert({
      provider: transcript.provider,
      external_id: transcript.externalId,
      meeting_title: transcript.meetingTitle,
      meeting_date: transcript.meetingDate.toISOString(),
      duration: transcript.duration,
      attendees: transcript.attendees,
      utterance_count: transcript.utterances.length,
      full_text: fullText,
      status: "pending",
      owner_user_id: options.ownerUserId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Handle race condition — unique constraint violation means duplicate
    if (error.code === "23505") {
      log.info(
        { provider: transcript.provider, externalId: transcript.externalId },
        "Duplicate transcript (constraint violation)"
      );
      const { data: dup } = await supabaseAdmin
        .from("transcripts")
        .select("id")
        .eq("provider", transcript.provider)
        .eq("external_id", transcript.externalId)
        .single();
      return { id: dup!.id, isDuplicate: true };
    }
    log.error({ error }, "Failed to insert transcript");
    throw error;
  }

  log.info(
    {
      transcriptId: data.id,
      provider: transcript.provider,
      meetingTitle: transcript.meetingTitle,
      utteranceCount: transcript.utterances.length,
    },
    "Transcript ingested"
  );

  return { id: data.id, isDuplicate: false };
}

/**
 * Update transcript processing status.
 */
export async function updateTranscriptStatus(
  transcriptId: string,
  status: "processing" | "completed" | "failed",
  errorMessage?: string
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === "completed") {
    updates.processed_at = new Date().toISOString();
  }
  if (errorMessage) {
    updates.error_message = errorMessage;
  }

  const { error } = await supabaseAdmin
    .from("transcripts")
    .update(updates)
    .eq("id", transcriptId);

  if (error) {
    log.error({ error, transcriptId }, "Failed to update transcript status");
    throw error;
  }
}

/**
 * Get a transcript by ID.
 */
export async function getTranscript(
  transcriptId: string
): Promise<TranscriptRow | null> {
  const { data, error } = await supabaseAdmin
    .from("transcripts")
    .select("*")
    .eq("id", transcriptId)
    .single();

  if (error) return null;
  return data;
}

/**
 * List transcripts with optional status filter.
 */
export async function listTranscripts(
  status?: string,
  limit: number = 50
): Promise<TranscriptRow[]> {
  let query = supabaseAdmin
    .from("transcripts")
    .select("*")
    .order("meeting_date", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    log.error({ error }, "Failed to list transcripts");
    throw error;
  }

  return data || [];
}
