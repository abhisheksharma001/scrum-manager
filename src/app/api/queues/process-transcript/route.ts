import { handleQueueCallback } from "@/lib/jobs/queue-client";
import { processTranscript } from "@/lib/jobs/processors";
import type { TranscriptProcessingJob } from "@/lib/jobs/queue";

export const maxDuration = 300;

export const POST = handleQueueCallback<TranscriptProcessingJob>(
  async (data) => {
    await processTranscript(data);
  }
);
