import { logger } from "@/lib/logger";
import type { DeveloperBrief } from "@/lib/types";
import { renderBriefHtml } from "./brief-renderer";

const log = logger.child({ service: "email" });

export async function sendBriefEmail(input: {
  to?: string;
  subject: string;
  brief: DeveloperBrief;
  trackerUrl: string | null;
}) {
  if (!input.to) return;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM are required for email delivery");
  }

  const html = renderBriefHtml(input.brief, input.trackerUrl);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ body }, "Failed to send brief email");
    throw new Error(`Resend error: ${res.status}`);
  }
}
