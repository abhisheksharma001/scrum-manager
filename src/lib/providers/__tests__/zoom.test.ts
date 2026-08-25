import { describe, it, expect, vi, afterEach } from "vitest";
import { parseVTT, ZoomProvider } from "../zoom";
import fs from "fs";
import path from "path";

describe("parseVTT", () => {
  it("parses a multi-speaker VTT into utterances", () => {
    const vtt = fs.readFileSync(
      path.join(process.cwd(), "test/fixtures/sample.vtt"),
      "utf-8"
    );
    const utterances = parseVTT(vtt);

    expect(utterances).toHaveLength(4);
    expect(utterances[0]).toEqual({
      speaker: "Sean",
      text: "Alright, let's get started. First up, the AppFolio webhook integration.",
      startTime: 1,
      endTime: 5,
    });
    expect(utterances[1].speaker).toBe("Alex");
    expect(utterances[3].speaker).toBe("Jordan");
  });

  it("returns an empty array for empty string", () => {
    expect(parseVTT("")).toEqual([]);
  });

  it("returns an empty array for WEBVTT header only", () => {
    expect(parseVTT("WEBVTT\n\n")).toEqual([]);
  });

  it("skips malformed blocks without timestamp lines", () => {
    const vtt = `WEBVTT

This is not a timestamp
Sean: Some text

00:00:01.000 --> 00:00:05.000
Alex: Valid utterance`;

    const utterances = parseVTT(vtt);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].speaker).toBe("Alex");
  });

  it("parses single-speaker VTT", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:03.000
Narrator: Welcome to the meeting.

00:00:04.000 --> 00:00:08.000
Narrator: Let's begin.`;

    const utterances = parseVTT(vtt);
    expect(utterances).toHaveLength(2);
    expect(utterances[0].speaker).toBe("Narrator");
    expect(utterances[1].speaker).toBe("Narrator");
  });

  it("handles text without speaker attribution", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:05.000
Just some text without a speaker`;

    const utterances = parseVTT(vtt);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].speaker).toBe("Unknown");
    expect(utterances[0].text).toBe("Just some text without a speaker");
  });

  it("parses timestamps correctly including hours", () => {
    const vtt = `WEBVTT

01:30:00.000 --> 01:30:05.500
Sean: Late in the meeting`;

    const utterances = parseVTT(vtt);
    expect(utterances[0].startTime).toBe(5400);
    expect(utterances[0].endTime).toBe(5405.5);
  });
});

describe("ZoomProvider", () => {
  const provider = new ZoomProvider();

  describe("validateWebhook", () => {
    it("returns true for URL validation events", () => {
      const result = provider.validateWebhook({}, {
        event: "endpoint.url_validation",
      });
      expect(result).toBe(true);
    });

    it("returns true for regular events without verification token", () => {
      const result = provider.validateWebhook(
        {},
        { event: "recording.completed" }
      );
      expect(result).toBe(true);
    });
  });

  describe("parseWebhook", () => {
    it("parses a valid recording.completed event", () => {
      const body = {
        event: "recording.completed",
        payload: {
          object: {
            uuid: "meeting-uuid-123",
            id: 12345,
            topic: "Sprint Planning",
            start_time: "2026-03-26T10:00:00Z",
            duration: 60,
            recording_files: [
              {
                id: "file-1",
                file_type: "TRANSCRIPT",
                download_url: "https://zoom.us/download/transcript",
                recording_type: "audio_transcript",
              },
            ],
          },
        },
      };

      const result = provider.parseWebhook(body);
      expect(result).toEqual({
        externalId: "meeting-uuid-123",
        metadata: {
          meetingId: 12345,
          topic: "Sprint Planning",
          startTime: "2026-03-26T10:00:00Z",
          duration: 60,
          downloadUrl: "https://zoom.us/download/transcript",
        },
      });
    });

    it("returns null for non-recording events", () => {
      expect(
        provider.parseWebhook({ event: "meeting.started" })
      ).toBeNull();
    });

    it("returns null for missing event field", () => {
      expect(provider.parseWebhook({})).toBeNull();
    });

    it("returns null when no transcript file in recording", () => {
      const body = {
        event: "recording.completed",
        payload: {
          object: {
            uuid: "uuid-456",
            recording_files: [
              { id: "f1", file_type: "MP4", download_url: "", recording_type: "shared_screen" },
            ],
          },
        },
      };
      expect(provider.parseWebhook(body)).toBeNull();
    });

    it("returns null when recording has no uuid", () => {
      const body = {
        event: "recording.completed",
        payload: { object: {} },
      };
      expect(provider.parseWebhook(body)).toBeNull();
    });
  });

  describe("fetchTranscript", () => {
    const provider = new ZoomProvider();
    const metadata = {
      meetingId: 12345,
      topic: "Sprint Planning",
      startTime: "2026-03-26T10:00:00Z",
      duration: 60,
      downloadUrl: "https://zoom.us/download/transcript.vtt",
    };

    const vttContent = `WEBVTT

00:00:01.000 --> 00:00:05.000
Sean: Let's start sprint planning.

00:00:06.000 --> 00:00:10.000
Alex: I'll take the webhook ticket.`;

    function mockFetchSequence(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn();
      for (const res of responses) {
        fetchMock.mockResolvedValueOnce(res as Response);
      }
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.ZOOM_ACCOUNT_ID;
      delete process.env.ZOOM_CLIENT_ID;
      delete process.env.ZOOM_CLIENT_SECRET;
    });

    it("throws when S2S OAuth credentials are missing", async () => {
      await expect(provider.fetchTranscript("uuid-1", metadata)).rejects.toThrow(
        /Zoom S2S OAuth is not configured/
      );
    });

    it("throws when the OAuth token request fails", async () => {
      process.env.ZOOM_ACCOUNT_ID = "acct";
      process.env.ZOOM_CLIENT_ID = "id";
      process.env.ZOOM_CLIENT_SECRET = "secret";

      const fetchMock = mockFetchSequence([
        { ok: false, status: 401, statusText: "Unauthorized" },
      ]);

      await expect(provider.fetchTranscript("uuid-1", metadata)).rejects.toThrow(
        /Zoom OAuth token request failed: 401/
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "grant_type=account_credentials&account_id=acct"
      );
    });

    it("throws when the transcript download fails", async () => {
      process.env.ZOOM_ACCOUNT_ID = "acct";
      process.env.ZOOM_CLIENT_ID = "id";
      process.env.ZOOM_CLIENT_SECRET = "secret";

      const fetchMock = mockFetchSequence([
        {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "token-abc" }),
        },
        { ok: false, status: 403, statusText: "Forbidden" },
      ]);

      await expect(provider.fetchTranscript("uuid-1", metadata)).rejects.toThrow(
        /Failed to download Zoom transcript: 403/
      );
      expect(fetchMock.mock.calls[1][0]).toBe(metadata.downloadUrl);
    });

    it("downloads the VTT and parses it on the happy path", async () => {
      process.env.ZOOM_ACCOUNT_ID = "acct";
      process.env.ZOOM_CLIENT_ID = "id";
      process.env.ZOOM_CLIENT_SECRET = "secret";

      const fetchMock = mockFetchSequence([
        {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "token-abc" }),
        },
        { ok: true, status: 200, text: async () => vttContent },
      ]);

      const transcript = await provider.fetchTranscript("uuid-1", metadata);

      // Token request uses Basic auth, download uses Bearer token
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({
        Authorization: expect.stringMatching(/^Basic /),
      });
      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({
        Authorization: "Bearer token-abc",
      });

      expect(transcript.provider).toBe("zoom");
      expect(transcript.externalId).toBe("uuid-1");
      expect(transcript.meetingTitle).toBe("Sprint Planning");
      expect(transcript.meetingDate).toEqual(new Date("2026-03-26T10:00:00Z"));
      expect(transcript.duration).toBe(60);
      expect(transcript.rawFormat).toBe("vtt");
      expect(transcript.utterances).toHaveLength(2);
      expect(transcript.utterances[0].speaker).toBe("Sean");
      expect(transcript.attendees).toEqual([
        { name: "Sean" },
        { name: "Alex" },
      ]);
    });

    it("falls back to utterance-derived duration and attendees", async () => {
      process.env.ZOOM_ACCOUNT_ID = "acct";
      process.env.ZOOM_CLIENT_ID = "id";
      process.env.ZOOM_CLIENT_SECRET = "secret";

      mockFetchSequence([
        {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "token-abc" }),
        },
        { ok: true, status: 200, text: async () => vttContent },
      ]);

      const transcript = await provider.fetchTranscript("uuid-2", {
        downloadUrl: "https://zoom.us/download/transcript.vtt",
      });

      expect(transcript.meetingTitle).toBe("Untitled Meeting");
      expect(transcript.duration).toBe(10); // last utterance endTime
      expect(transcript.utterances).toHaveLength(2);
    });
  });
});
