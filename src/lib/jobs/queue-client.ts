import { QueueClient, type VercelRegion } from "@vercel/queue";

const queueRegion = (process.env.VERCEL_REGION || "iad1") as VercelRegion;

export const queueClient = new QueueClient({ region: queueRegion });
export const { handleCallback: handleQueueCallback, send: sendQueueMessage } =
  queueClient;
