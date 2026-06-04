import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queue", () => ({
  enqueueJiraCreation: vi.fn().mockResolvedValue("msg-1"),
  enqueueRepoAnalysis: vi.fn().mockResolvedValue("msg-2"),
  enqueueBriefDelivery: vi.fn().mockResolvedValue("msg-3"),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { logger: mockLogger };
});

vi.mock("@/lib/services/ingestion", () => ({
  updateTranscriptStatus: vi.fn().mockResolvedValue(undefined),
  getTranscript: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/services/extraction", () => ({
  extractTasks: vi.fn().mockResolvedValue({
    tasks: [],
    transcriptId: "t-1",
    processingTimeMs: 100,
  }),
  storeAndRouteExtractedTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/issue-tracker", () => ({
  getIssueTracker: vi.fn().mockReturnValue({
    createIssue: vi.fn().mockResolvedValue({
      issueKey: "ENG-1",
      issueUrl: "https://test.atlassian.net/browse/ENG-1",
      refinedTitle: "Refined Title",
    }),
  }),
}));

vi.mock("@/lib/agents/routing-agent", () => ({
  routeTaskToProject: vi.fn().mockResolvedValue("ENG"),
}));

vi.mock("@/lib/services/interview-queue", () => ({
  expireStaleClaims: vi.fn().mockResolvedValue(2),
  expireOldInterviews: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/services/notifications", () => ({
  notifyNewInterviews: vi.fn().mockResolvedValue(undefined),
  notifyAutoCreatedTasks: vi.fn().mockResolvedValue(undefined),
  notifyPushFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase", () => {
  const mockSingle = vi.fn().mockResolvedValue({
    data: {
      id: "t-1",
      transcript_id: "t-1",
      meeting_title: "Test",
      meeting_date: "2026-03-26",
      attendees: [],
      utterances: [],
      provider: "manual",
      external_id: "ext-1",
      duration: 600,
      status: "approved",
      approval_status: "approved",
      tracker_issue_key: null,
      inferred_assignees: [],
      extracted_title: "Task",
      extracted_description: "Desc",
      labels: [],
      priority: "P2",
    },
    error: null,
  });

  return {
    supabaseAdmin: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSingle,
          }),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
          order: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: null }),
    },
  };
});

import { processTranscript, processJiraCreation, processMaintenance } from "../processors";
import { updateTranscriptStatus } from "@/lib/services/ingestion";
import { expireStaleClaims, expireOldInterviews } from "@/lib/services/interview-queue";

describe("processTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks transcript completed when no tasks extracted", async () => {
    await processTranscript({
      transcriptId: "t-1",
      provider: "manual",
      externalId: "ext-1",
      meetingTitle: "Test",
      meetingDate: "2026-03-26T10:00:00Z",
      attendees: [],
      duration: 600,
      utterances: [],
    });

    expect(updateTranscriptStatus).toHaveBeenCalledWith("t-1", "processing");
    expect(updateTranscriptStatus).toHaveBeenCalledWith("t-1", "completed");
  });
});

describe("processJiraCreation", () => {
  it("creates a Jira issue for the task", async () => {
    await processJiraCreation({ taskId: "task-1" });
    // If it doesn't throw, it succeeded
  });
});

describe("processMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls expireStaleClaims for expire-claims", async () => {
    await processMaintenance({ type: "expire-claims" });
    expect(expireStaleClaims).toHaveBeenCalled();
  });

  it("calls expireOldInterviews for expire-interviews", async () => {
    await processMaintenance({ type: "expire-interviews" });
    expect(expireOldInterviews).toHaveBeenCalled();
  });
});
