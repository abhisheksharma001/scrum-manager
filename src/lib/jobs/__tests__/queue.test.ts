import { describe, it, expect, vi, beforeEach } from "vitest";

const { MockQueueClient, mockSend } = vi.hoisted(() => {
  const mockSend = vi.fn().mockResolvedValue({ messageId: "msg-1" });
  const mockHandleCallback = vi.fn((handler) => handler);
  const MockQueueClient = vi.fn(function QueueClientMock() {
    return {
      send: mockSend,
      handleCallback: mockHandleCallback,
    };
  });
  return { MockQueueClient, mockSend };
});

vi.mock("@vercel/queue", () => ({
  QueueClient: MockQueueClient,
}));

import { getRedisConnection, enqueueTranscriptProcessing, enqueueJiraCreation } from "../queue";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRedisConnection", () => {
  it("returns default host and port when env not set", () => {
    delete process.env.REDIS_URL;
    delete process.env.tandem_REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;

    const conn = getRedisConnection();
    expect(conn.host).toBe("localhost");
    expect(conn.port).toBe(6379);
  });

  it("reads host and port from env", () => {
    delete process.env.REDIS_URL;
    delete process.env.tandem_REDIS_URL;
    process.env.REDIS_HOST = "redis.example.com";
    process.env.REDIS_PORT = "6380";

    const conn = getRedisConnection();
    expect(conn.host).toBe("redis.example.com");
    expect(conn.port).toBe(6380);

    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
  });

  it("prefers REDIS_URL over REDIS_HOST", () => {
    process.env.REDIS_URL = "rediss://default:pass@my-redis.upstash.io:6379";
    process.env.REDIS_HOST = "should-not-use";

    const conn = getRedisConnection();
    expect(conn.host).toBe("my-redis.upstash.io");
    expect(conn.password).toBe("pass");
    expect(conn.tls).toEqual({});

    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
  });

  it("falls back to tandem_REDIS_URL", () => {
    delete process.env.REDIS_URL;
    process.env.tandem_REDIS_URL = "rediss://default:secret@tandem.upstash.io:6379";

    const conn = getRedisConnection();
    expect(conn.host).toBe("tandem.upstash.io");
    expect(conn.password).toBe("secret");

    delete process.env.tandem_REDIS_URL;
  });
});

describe("enqueueTranscriptProcessing", () => {
  it("sends to Vercel Queue and returns messageId", async () => {
    const id = await enqueueTranscriptProcessing({
      transcriptId: "t-1",
      provider: "manual",
      externalId: "ext-1",
      meetingTitle: "Test",
      meetingDate: "2026-03-26T10:00:00Z",
      attendees: [],
      duration: 600,
      utterances: [],
    });

    expect(id).toBe("msg-1");
    expect(mockSend).toHaveBeenCalledWith("transcript-processing", expect.objectContaining({
      transcriptId: "t-1",
    }));
  });
});

describe("enqueueJiraCreation", () => {
  it("sends to Vercel Queue and returns messageId", async () => {
    const id = await enqueueJiraCreation({ taskId: "task-1" });
    expect(id).toBe("msg-1");
    expect(mockSend).toHaveBeenCalledWith("jira-creation", { taskId: "task-1" });
  });
});
