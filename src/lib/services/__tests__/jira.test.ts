import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateIssue, mockRetryFailed, mockCheckDuplicates } = vi.hoisted(() => ({
  mockCreateIssue: vi.fn(),
  mockRetryFailed: vi.fn(),
  mockCheckDuplicates: vi.fn(),
}));

vi.mock("@/lib/issue-tracker", () => ({
  getIssueTracker: vi.fn().mockReturnValue({
    createIssue: mockCreateIssue,
    retryFailedIssue: mockRetryFailed,
    checkForDuplicates: mockCheckDuplicates,
  }),
}));

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/lib/agents/requirements-agent", () => ({
  refineRequirements: vi.fn(),
}));

import {
  createJiraIssue,
  createJiraIssueWithRequirements,
  retryJiraCreation,
  checkForDuplicates,
} from "../jira";
import type { ExtractedTaskRow } from "@/lib/types";

function makeTask(overrides: Partial<ExtractedTaskRow> = {}): ExtractedTaskRow {
  return {
    id: "task-1",
    transcript_id: "t-1",
    extracted_title: "Ship webhook",
    extracted_description: "Full description",
    inferred_assignees: [],
    confidence: "high",
    work_type: "code",
    repo_context_needed: true,
    approval_status: "approved",
    approved_by: "user-1",
    approved_at: "2026-03-26T00:00:00Z",
    assigned_developer_name: null,
    assigned_developer_email: null,
    repo_confidence: null,
    routing_confidence: null,
    missing_context: [],
    source_quotes: [],
    priority: "P1",
    labels: ["backend"],
    status: "approved",
    claimed_by: null,
    claimed_at: null,
    claim_expires_at: null,
    dismissed_reason: null,
    interview_responses: null,
    tracker_project: null,
    tracker_issue_key: null,
    tracker_error: null,
    suggested_interviewer: null,
    created_at: "2026-03-26T00:00:00Z",
    updated_at: "2026-03-26T00:00:00Z",
    ...overrides,
  };
}

describe("jira facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createJiraIssue", () => {
    it("delegates to getIssueTracker().createIssue", async () => {
      mockCreateIssue.mockResolvedValue({
        issueKey: "TEST-1",
        issueUrl: "https://test.atlassian.net/browse/TEST-1",
        refinedTitle: "Refined",
      });

      const task = makeTask();
      const result = await createJiraIssue(task, "TEST");

      expect(mockCreateIssue).toHaveBeenCalledWith(task, "TEST");
      expect(result.issueKey).toBe("TEST-1");
    });
  });

  describe("createJiraIssueWithRequirements", () => {
    it("delegates task row to getIssueTracker().createIssue", async () => {
      mockCreateIssue.mockResolvedValue({
        issueKey: "TEST-2",
        issueUrl: "https://test.atlassian.net/browse/TEST-2",
        refinedTitle: "Refined Title",
      });

      const task = makeTask();
      const result = await createJiraIssueWithRequirements(task, "TEST");

      expect(mockCreateIssue).toHaveBeenCalledWith(task, "TEST");
      expect(result.refinedTitle).toBe("Refined Title");
    });

    it("fetches task from DB when given a string ID", async () => {
      const task = makeTask();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: task, error: null }),
          }),
        }),
      });

      mockCreateIssue.mockResolvedValue({
        issueKey: "TEST-3",
        issueUrl: "https://test.atlassian.net/browse/TEST-3",
        refinedTitle: "From ID",
      });

      const result = await createJiraIssueWithRequirements("task-1", "TEST");
      expect(result.issueKey).toBe("TEST-3");
    });

    it("throws when task not found by ID", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
          }),
        }),
      });

      await expect(createJiraIssueWithRequirements("nonexistent")).rejects.toThrow("Task not found");
    });
  });

  describe("retryJiraCreation", () => {
    it("delegates to getIssueTracker().retryFailedIssue", async () => {
      mockRetryFailed.mockResolvedValue({
        issueKey: "TEST-4",
        issueUrl: "https://test.atlassian.net/browse/TEST-4",
      });

      const result = await retryJiraCreation("task-1");
      expect(mockRetryFailed).toHaveBeenCalledWith("task-1");
      expect(result.issueKey).toBe("TEST-4");
    });
  });

  describe("checkForDuplicates", () => {
    it("delegates to getIssueTracker().checkForDuplicates", async () => {
      mockCheckDuplicates.mockResolvedValue([
        { key: "TEST-1", summary: "Ship webhook", similarity: 0.95 },
      ]);

      const result = await checkForDuplicates(null, "Ship webhook", "TEST", 7);
      expect(mockCheckDuplicates).toHaveBeenCalledWith("Ship webhook", "TEST", 7);
      expect(result).toHaveLength(1);
    });
  });
});
