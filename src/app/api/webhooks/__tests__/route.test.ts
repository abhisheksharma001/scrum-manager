import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { getProvider } from "@/lib/providers";
import { ingestTranscript } from "@/lib/services/ingestion";
import { enqueueTranscriptProcessing } from "@/lib/jobs/queue";
import { POST } from "../[provider]/route";
import type { NormalizedTranscript } from "@/lib/types";

vi.mock("@/lib/providers/google-meet", () => ({}));
vi.mock("@/lib/providers/zoom", () => ({}));
vi.mock("@/lib/providers/ms-teams", () => ({}));
vi.mock("@/lib/providers/n8n", () => ({}));

vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(),
}));

vi.mock("@/lib/services/ingestion", () => ({
  ingestTranscript: vi.fn(),
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueTranscriptProcessing: vi.fn(),
}));

const secret = process.env.WEBHOOK_SECRET!;

const sampleTranscript: NormalizedTranscript = {
  provider: "google-meet",
  externalId: "ext-1",
  meetingTitle: "Test meeting",
  meetingDate: new Date("2025-01-15T12:00:00.000Z"),
  duration: 120,
  attendees: [],
  utterances: [],
  rawFormat: "json",
  metadata: {},
};

describe("POST /api/webhooks/[provider]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with transcriptId when webhook is valid", async () => {
    const mockProvider = {
      name: "google-meet",
      validateWebhook: vi.fn().mockReturnValue(true),
      parseWebhook: vi.fn().mockReturnValue({ externalId: "ext-1" }),
      fetchTranscript: vi.fn().mockResolvedValue(sampleTranscript),
    };
    vi.mocked(getProvider).mockReturnValue(mockProvider as never);
    vi.mocked(ingestTranscript).mockResolvedValue({
      id: "trans-abc",
      isDuplicate: false,
    });
    vi.mocked(enqueueTranscriptProcessing).mockResolvedValue("job-1");

    const response = await POST(
      new NextRequest("http://localhost/api/webhooks/google-meet", {
        method: "POST",
        headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ event: "recording.completed" }),
      }),
      { params: Promise.resolve({ provider: "google-meet" }) }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ ok: true, transcriptId: "trans-abc" });
    expect(enqueueTranscriptProcessing).toHaveBeenCalledOnce();
  });

  it("returns 401 when secret is wrong", async () => {
    vi.mocked(getProvider).mockReturnValue({
      name: "google-meet",
      parseWebhook: vi.fn(),
      fetchTranscript: vi.fn(),
    } as never);

    const response = await POST(
      new NextRequest("http://localhost/api/webhooks/google-meet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-secret",
        },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ provider: "google-meet" }) }
    );

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 for unknown provider", async () => {
    vi.mocked(getProvider).mockReturnValue(undefined);

    const response = await POST(
      new NextRequest("http://localhost/api/webhooks/unknown", {
        method: "POST",
        headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ provider: "unknown" }) }
    );

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("Unknown provider");
  });

  it("returns 200 { ok: true } when parseWebhook returns null", async () => {
    const mockProvider = {
      name: "zoom",
      validateWebhook: vi.fn().mockReturnValue(true),
      parseWebhook: vi.fn().mockReturnValue(null),
      fetchTranscript: vi.fn(),
    };
    vi.mocked(getProvider).mockReturnValue(mockProvider as never);

    const response = await POST(
      new NextRequest("http://localhost/api/webhooks/zoom", {
        method: "POST",
        headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ event: "endpoint.url_validation" }),
      }),
      { params: Promise.resolve({ provider: "zoom" }) }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ ok: true });
    expect(mockProvider.fetchTranscript).not.toHaveBeenCalled();
  });

  it("returns 401 when provider validateWebhook rejects the payload", async () => {
    const mockProvider = {
      name: "ms-teams",
      validateWebhook: vi.fn().mockReturnValue(false),
      parseWebhook: vi.fn(),
      fetchTranscript: vi.fn(),
    };
    vi.mocked(getProvider).mockReturnValue(mockProvider as never);

    const response = await POST(
      new NextRequest("http://localhost/api/webhooks/ms-teams", {
        method: "POST",
        headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ value: [] }),
      }),
      { params: Promise.resolve({ provider: "ms-teams" }) }
    );

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mockProvider.parseWebhook).not.toHaveBeenCalled();
    expect(mockProvider.fetchTranscript).not.toHaveBeenCalled();
  });

  it("passes request headers to provider validateWebhook", async () => {
    const mockProvider = {
      name: "zoom",
      validateWebhook: vi.fn().mockReturnValue(true),
      parseWebhook: vi.fn().mockReturnValue(null),
      fetchTranscript: vi.fn(),
    };
    vi.mocked(getProvider).mockReturnValue(mockProvider as never);

    await POST(
      new NextRequest("http://localhost/api/webhooks/zoom", {
        method: "POST",
        headers: { "x-webhook-secret": secret, "x-zm-signature": "sig-123" },
        body: JSON.stringify({ event: "recording.completed" }),
      }),
      { params: Promise.resolve({ provider: "zoom" }) }
    );

    expect(mockProvider.validateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ "x-zm-signature": "sig-123" }),
      { event: "recording.completed" }
    );
  });

  it("echoes validationToken as plain text for MS Graph validation handshake", async () => {
    const mockProvider = {
      name: "ms-teams",
      validateWebhook: vi.fn().mockReturnValue(true),
      parseWebhook: vi.fn(),
      fetchTranscript: vi.fn(),
    };
    vi.mocked(getProvider).mockReturnValue(mockProvider as never);

    const response = await POST(
      new NextRequest("http://localhost/api/webhooks/ms-teams", {
        method: "POST",
        headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ validationToken: "Validation: xyz123" }),
      }),
      { params: Promise.resolve({ provider: "ms-teams" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("Validation: xyz123");
    expect(mockProvider.parseWebhook).not.toHaveBeenCalled();
    expect(mockProvider.fetchTranscript).not.toHaveBeenCalled();
  });
});
