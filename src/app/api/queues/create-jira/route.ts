import { handleQueueCallback } from "@/lib/jobs/queue-client";
import { processJiraCreation } from "@/lib/jobs/processors";
import type { JiraCreationJob } from "@/lib/jobs/queue";

export const POST = handleQueueCallback<JiraCreationJob>(
  async (data) => {
    await processJiraCreation(data);
  }
);
