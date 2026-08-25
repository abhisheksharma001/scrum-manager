import type { NormalizedTranscript, Utterance } from "@/lib/types";
import type { TranscriptProviderAdapter, ProviderConfig } from "./base";
import { registerProvider } from "./base";
import { logger } from "@/lib/logger";

/**
 * Zoom transcript provider.
 *
 * Trigger: Direct HTTP webhook — recording.completed event
 * Format: WebVTT (.vtt) file
 * Auth: Server-to-Server OAuth
 */
export class ZoomProvider implements TranscriptProviderAdapter {
  readonly name = "zoom";
  private config: ProviderConfig = {};
  private verificationToken = "";

  async initialize(config: ProviderConfig) {
    this.config = config;
    this.verificationToken = (config.webhookVerificationToken as string) || "";
    logger.info({ provider: this.name }, "Zoom provider initialized");
  }

  async startListening() {
    // Zoom uses direct HTTP webhooks — no setup needed beyond endpoint registration
    logger.info({ provider: this.name }, "Ready to receive webhooks");
  }

  async stopListening() {
    logger.info({ provider: this.name }, "Stopped listening");
  }

  validateWebhook(headers: Record<string, string>, body: unknown): boolean {
    // Zoom webhook validation: check the authorization header or event verification
    const payload = body as { event?: string; payload?: { plainToken?: string } };

    // Zoom URL validation challenge
    if (payload?.event === "endpoint.url_validation") {
      return true; // Handled separately in parseWebhook
    }

    // For regular events, verify using the webhook secret token
    // In production: use HMAC verification with x-zm-signature header
    const signature = headers["x-zm-signature"];
    if (!signature && this.verificationToken) {
      return false;
    }

    // TODO: Implement full HMAC-SHA256 verification
    return true;
  }

  parseWebhook(body: unknown): { externalId: string; metadata?: Record<string, unknown> } | null {
    const payload = body as {
      event?: string;
      payload?: {
        plainToken?: string;
        object?: {
          uuid?: string;
          id?: number;
          topic?: string;
          start_time?: string;
          duration?: number;
          recording_files?: Array<{
            id: string;
            file_type: string;
            download_url: string;
            recording_type: string;
          }>;
        };
      };
    };

    if (!payload?.event) return null;

    // Only process recording.completed events with transcript files
    if (payload.event !== "recording.completed") {
      return null;
    }

    const recording = payload.payload?.object;
    if (!recording?.uuid) return null;

    // Find the transcript file in recording_files
    const transcriptFile = recording.recording_files?.find(
      (f) => f.file_type === "TRANSCRIPT"
    );

    if (!transcriptFile) {
      logger.info({ meetingId: recording.uuid }, "recording.completed but no transcript file");
      return null;
    }

    return {
      externalId: recording.uuid,
      metadata: {
        meetingId: recording.id,
        topic: recording.topic,
        startTime: recording.start_time,
        duration: recording.duration,
        downloadUrl: transcriptFile.download_url,
      },
    };
  }

  async fetchTranscript(
    externalId: string,
    metadata?: Record<string, unknown>
  ): Promise<NormalizedTranscript> {
    logger.info({ externalId }, "Fetching Zoom transcript");

    const downloadUrl = metadata?.downloadUrl as string | undefined;
    if (!downloadUrl) {
      throw new Error(
        `No transcript downloadUrl in webhook metadata for: ${externalId}.`
      );
    }

    const token = await fetchZoomOAuthToken();
    const vttContent = await downloadTranscript(downloadUrl, token);
    const utterances = parseVTT(vttContent);

    // Derive attendees from the speakers seen in the transcript
    const attendees = Array.from(new Set(utterances.map((u) => u.speaker)))
      .filter((s) => s !== "Unknown")
      .map((name) => ({ name }));

    return {
      provider: "zoom",
      externalId,
      meetingTitle:
        (metadata?.topic as string | undefined) || "Untitled Meeting",
      meetingDate: metadata?.startTime
        ? new Date(metadata.startTime as string)
        : new Date(),
      duration:
        (metadata?.duration as number | undefined) ||
        (utterances.length > 0
          ? Math.max(...utterances.map((u) => u.endTime))
          : 0),
      attendees,
      utterances,
      rawFormat: "vtt",
      metadata: {
        source: "zoom",
        meetingId: metadata?.meetingId,
        downloadedAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * Get a Server-to-Server OAuth access token from Zoom.
 *
 * NOTE: This path has only been verified against mocked HTTP responses.
 * Live verification requires real Zoom Server-to-Server OAuth credentials
 * (account id + client id + client secret) from a Zoom Marketplace app.
 */
async function fetchZoomOAuthToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error(
      "Zoom S2S OAuth is not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET."
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Zoom OAuth token request failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Zoom OAuth token response missing access_token");
  }

  return data.access_token;
}

/**
 * Download the VTT transcript file from the recording's downloadUrl.
 */
async function downloadTranscript(
  downloadUrl: string,
  accessToken: string
): Promise<string> {
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download Zoom transcript: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

/**
 * Parse a WebVTT transcript into utterances.
 * VTT format:
 *   WEBVTT
 *
 *   00:00:01.000 --> 00:00:05.000
 *   Speaker Name: The text they said
 */
export function parseVTT(vttContent: string): Utterance[] {
  const utterances: Utterance[] = [];
  const blocks = vttContent.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    // Find the timestamp line
    const timestampLine = lines.find((l) =>
      /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(l)
    );
    if (!timestampLine) continue;

    const [startStr, endStr] = timestampLine.split("-->").map((s) => s.trim());
    const startTime = parseVTTTimestamp(startStr);
    const endTime = parseVTTTimestamp(endStr);

    // Text lines come after the timestamp
    const timestampIndex = lines.indexOf(timestampLine);
    const textLines = lines.slice(timestampIndex + 1).join(" ");

    // Try to extract speaker from "Speaker: text" format
    const speakerMatch = textLines.match(/^([^:]+):\s*(.+)$/);
    const speaker = speakerMatch ? speakerMatch[1].trim() : "Unknown";
    const text = speakerMatch ? speakerMatch[2].trim() : textLines.trim();

    if (text) {
      utterances.push({ speaker, text, startTime, endTime });
    }
  }

  return utterances;
}

function parseVTTTimestamp(ts: string): number {
  const parts = ts.split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const [secs, ms] = parts[2].split(".");
  // Normalize to 3-digit milliseconds (e.g., "3" → 300ms, "03" → 30ms, "030" → 30ms)
  const normalizedMs = parseInt((ms + "000").slice(0, 3), 10);
  return hours * 3600 + minutes * 60 + parseInt(secs, 10) + normalizedMs / 1000;
}

// Self-register
registerProvider(new ZoomProvider());
