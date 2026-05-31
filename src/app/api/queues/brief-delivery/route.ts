import { handleCallback } from "@vercel/queue";
import { processBriefDelivery } from "@/lib/jobs/processors";
import type { BriefDeliveryJob } from "@/lib/jobs/queue";

export const POST = handleCallback(async (payload: BriefDeliveryJob) => {
  await processBriefDelivery(payload);
});
