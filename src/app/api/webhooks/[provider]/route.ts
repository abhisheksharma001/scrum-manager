import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getProvider } from "@/lib/providers";
import { ingestTranscript } from "@/lib/services/ingestion";
import { enqueueTranscriptProcessing } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { apiError } from "@/lib/errors";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

import "@/lib/providers/google-meet";
import "@/lib/providers/zoom";
import "@/lib/providers/ms-teams";
import "@/lib/providers/n8n";

const log = logger.child({ route: "webhooks" });
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function verifySecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerName } = await params;

  try {
    await rateLimit(`webhook:${getClientIp(request)}`, {
      windowMs: 60_000,
      max: 30,
    });

    if (!WEBHOOK_SECRET) {
      log.error("WEBHOOK_SECRET is not configured");
      return NextResponse.json(
        { error: "Webhook auth not configured" },
        { status: 500 }
      );
    }

    const providedSecret =
      request.headers.get("x-webhook-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!providedSecret || !verifySecret(providedSecret, WEBHOOK_SECRET)) {
      log.warn({ provider: providerName }, "Webhook auth failed");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const provider = getProvider(providerName);
    if (!provider) {
      return NextResponse.json(
        { error: `Unknown provider: ${providerName}` },
        { status: 404 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Provider-level validation (HMAC, clientState, etc.) on top of the shared secret
    const headers = Object.fromEntries(request.headers);
    if (!provider.validateWebhook(headers, body)) {
      log.warn({ provider: providerName }, "Provider webhook validation failed");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // MS Graph validation handshake — must echo the token as plain text
    const validationToken = (body as { validationToken?: unknown })?.validationToken;
    if (typeof validationToken === "string") {
      return new NextResponse(validationToken, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const parsed = provider.parseWebhook(body);
    if (!parsed) {
      return NextResponse.json({ ok: true });
    }

    log.info(
      { provider: providerName, externalId: parsed.externalId },
      "Webhook received"
    );

    const transcript = await provider.fetchTranscript(
      parsed.externalId,
      parsed.metadata
    );
    const { id: transcriptId, isDuplicate } =
      await ingestTranscript(transcript);

    if (isDuplicate) {
      return NextResponse.json({ ok: true, transcriptId, duplicate: true });
    }

    await enqueueTranscriptProcessing({
      transcriptId,
      provider: transcript.provider,
      externalId: transcript.externalId,
      meetingTitle: transcript.meetingTitle,
      meetingDate: transcript.meetingDate.toISOString(),
      attendees: transcript.attendees,
      duration: transcript.duration,
      utterances: transcript.utterances,
    });

    return NextResponse.json({ ok: true, transcriptId });
  } catch (err) {
    return apiError(err, { route: "webhooks", provider: providerName });
  }
}
