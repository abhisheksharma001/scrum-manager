import { handleQueueCallback } from "@/lib/jobs/queue-client";
import { processRepoAnalysis } from "@/lib/jobs/processors";
import type { RepoAnalysisJob } from "@/lib/jobs/queue";

export const POST = handleQueueCallback(async (payload: RepoAnalysisJob) => {
  await processRepoAnalysis(payload);
});
