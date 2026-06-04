import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatTimestamp, formatTranscript, mapToExtractedTask, storeAndRouteExtractedTasks } from "../extraction-agent";
import type { NormalizedTranscript } from "@/lib/types";

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn() },
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

describe("formatTimestamp", () => {
  it("formats 0 seconds", () => {
    expect(formatTimestamp(0)).toBe("0:00");
  });

  it("formats seconds only", () => {
    expect(formatTimestamp(45)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatTimestamp(65)).toBe("1:05");
  });

  it("formats with zero-padded seconds", () => {
    expect(formatTimestamp(60)).toBe("1:00");
  });

  it("includes hours when present", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  it("formats exactly one hour", () => {
    expect(formatTimestamp(3600)).toBe("1:00:00");
  });

  it("formats large values", () => {
    expect(formatTimestamp(7384)).toBe("2:03:04");
  });
});

describe("formatTranscript", () => {
  it("converts utterances to timestamped speaker lines", () => {
    const transcript: NormalizedTranscript = {
      provider: "manual",
      externalId: "test",
      meetingTitle: "Test",
      meetingDate: new Date(),
      duration: 100,
      attendees: [],
      utterances: [
        { speaker: "Sean", text: "Hello", startTime: 0, endTime: 5 },
        { speaker: "Alex", text: "Hi there", startTime: 65, endTime: 70 },
      ],
      rawFormat: "text",
      metadata: {},
    };

    const result = formatTranscript(transcript);
    expect(result).toBe("[0:00] Sean: Hello\n[1:05] Alex: Hi there");
  });

  it("returns empty string for empty utterances", () => {
    const transcript: NormalizedTranscript = {
      provider: "manual",
      externalId: "test",
      meetingTitle: "Test",
      meetingDate: new Date(),
      duration: 0,
      attendees: [],
      utterances: [],
      rawFormat: "text",
      metadata: {},
    };
    expect(formatTranscript(transcript)).toBe("");
  });
});

describe("mapToExtractedTask", () => {
  it("maps schema output to ExtractedTask with all fields", () => {
    const input = {
      title: "Ship webhook",
      description: "Implement the handler",
      inferredAssignees: [
        { name: "Alex", email: "alex@example.com" },
        { name: "Jordan" },
      ],
      confidence: "high" as const,
      workType: "code" as const,
      repoContextNeeded: true,
      missingContext: ["What's the deadline?"],
      sourceQuotes: [{ speaker: "Alex", text: "Alex said Friday", timestamp: 30 }],
      priority: "P1" as const,
      labels: ["backend"],
      suggestedInterviewer: { name: "Alex", email: "alex@example.com" },
    };

    const result = mapToExtractedTask(input);
    expect(result).toEqual({
      title: "Ship webhook",
      description: "Implement the handler",
      inferredAssignees: [
        { name: "Alex", email: "alex@example.com" },
        { name: "Jordan", email: undefined },
      ],
      confidence: "high",
      workType: "code",
      repoContextNeeded: true,
      missingContext: ["What's the deadline?"],
      sourceQuotes: [{ speaker: "Alex", text: "Alex said Friday", timestamp: 30 }],
      priority: "P1",
      labels: ["backend"],
      suggestedInterviewer: { name: "Alex", email: "alex@example.com" },
    });
  });
});

describe("storeAndRouteExtractedTasks", async () => {
  const supabaseMod = await import("@/lib/supabase");
  const { supabaseAdmin } = vi.mocked(supabaseMod);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes high-confidence code tasks to pending_repo_analysis", async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "task-1" }, error: null }),
      }),
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue({ insert: mockInsert } as never);

    const result = await storeAndRouteExtractedTasks({
      tasks: [
        {
          title: "High conf task",
          description: "desc",
          inferredAssignees: [{ name: "Alex", email: "alex@example.com" }],
          confidence: "high",
          workType: "code",
          repoContextNeeded: true,
          missingContext: [],
          sourceQuotes: [],
          priority: "P1",
          labels: [],
        },
      ],
      transcriptId: "t-1",
      processingTimeMs: 100,
    });

    expect(result).toEqual(["task-1"]);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.status).toBe("pending_repo_analysis");
  });

  it("routes medium-confidence tasks to pending_interview", async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "task-2" }, error: null }),
      }),
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue({ insert: mockInsert } as never);

    const result = await storeAndRouteExtractedTasks({
      tasks: [
        {
          title: "Med conf task",
          description: "desc",
          inferredAssignees: [],
          confidence: "medium",
          workType: "non_code",
          repoContextNeeded: false,
          missingContext: [],
          sourceQuotes: [],
          priority: "P2",
          labels: [],
        },
      ],
      transcriptId: "t-1",
      processingTimeMs: 100,
    });

    expect(result).toEqual(["task-2"]);
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.status).toBe("pending_interview");
  });

  it("routes high-confidence tasks with missing context to pending_interview", async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "task-missing" }, error: null }),
      }),
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue({ insert: mockInsert } as never);

    await storeAndRouteExtractedTasks({
      tasks: [
        {
          title: "Ship feature",
          description: "desc",
          inferredAssignees: [{ name: "Alex", email: "alex@example.com" }],
          confidence: "high",
          workType: "code",
          repoContextNeeded: true,
          missingContext: ["Which repo should be changed?"],
          sourceQuotes: [],
          priority: "P1",
          labels: ["backend"],
        },
      ],
      transcriptId: "t-1",
      processingTimeMs: 100,
    });

    expect(mockInsert.mock.calls[0][0].status).toBe("pending_interview");
  });

  it("routes clear non-code tasks to awaiting approval", async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "task-3" }, error: null }),
      }),
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue({ insert: mockInsert } as never);

    await storeAndRouteExtractedTasks(
      {
        tasks: [
          {
            title: "Med task",
            description: "d",
            inferredAssignees: [{ name: "Priya", email: "priya@example.com" }],
            confidence: "medium",
            workType: "non_code",
            repoContextNeeded: false,
            missingContext: [],
            sourceQuotes: [],
            priority: "P2",
            labels: [],
          },
        ],
        transcriptId: "t-1",
        processingTimeMs: 0,
      },
      ["high", "medium"]
    );

    expect(mockInsert.mock.calls[0][0].status).toBe("awaiting_approval");
  });

  it("continues on DB insert failure and returns partial IDs", async () => {
    let callCount = 0;
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ data: null, error: { message: "DB error" } });
          }
          return Promise.resolve({ data: { id: "task-ok" }, error: null });
        }),
      }),
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue({ insert: mockInsert } as never);

    const result = await storeAndRouteExtractedTasks({
      tasks: [
        { title: "Fail", description: "d", inferredAssignees: [], confidence: "high", workType: "code", repoContextNeeded: true, missingContext: [], sourceQuotes: [], priority: "P1", labels: [] },
        { title: "Success", description: "d", inferredAssignees: [], confidence: "high", workType: "code", repoContextNeeded: true, missingContext: [], sourceQuotes: [], priority: "P1", labels: [] },
      ],
      transcriptId: "t-1",
      processingTimeMs: 0,
    });

    expect(result).toEqual(["task-ok"]);
  });
});
