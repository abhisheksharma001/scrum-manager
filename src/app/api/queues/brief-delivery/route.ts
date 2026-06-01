import { handleQueueCallback } from "@/lib/jobs/queue-client";
import { processBriefDelivery } from "@/lib/jobs/processors";
import type { BriefDeliveryJob } from "@/lib/jobs/queue";

export const POST = handleQueueCallback(async (payload: BriefDeliveryJob) => {
  await processBriefDelivery(payload);
});
