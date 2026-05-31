import { handleCallback } from "@vercel/queue";
import { processRepoAnalysis } from "@/lib/jobs/processors";
import type { RepoAnalysisJob } from "@/lib/jobs/queue";

export const POST = handleCallback(async (payload: RepoAnalysisJob) => {
  await processRepoAnalysis(payload);
});
