import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtractedTaskRow } from "@/lib/types";
import type { IssueTrackerProvider } from "../types";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/lib/agents/requirements-agent", () => ({
  refineRequirements: vi.fn().mockResolvedValue({
    title: "Refined Task",
    issueType: "Task",
    description: "Refined description",
    acceptanceCriteria: ["AC1"],
    priority: "P1",
    labels: ["backend"],
    assignee: null,
  }),
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

import { JiraProvider } from "../jira/jira-provider";

const mockFetch = vi.fn();

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

describe("JiraProvider", () => {
  const originalEnv = { ...process.env };
  let provider: JiraProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    provider = new JiraProvider();
    process.env.JIRA_BASE_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "test@example.com";
    process.env.JIRA_API_TOKEN = "test-token";
    process.env.JIRA_DEFAULT_PROJECT = "TEST";

    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { attendees: [] }, error: null }),
        }),
      }),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("implements IssueTrackerProvider interface", () => {
    const _typeCheck: IssueTrackerProvider = provider;
    expect(_typeCheck.name).toBe("jira");
  });

  describe("createIssue", () => {
    it("creates issue and returns key + URL + refinedTitle", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ issueTypes: [{ name: "Task" }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ key: "TEST-1", self: "..." }),
        });

      const result = await provider.createIssue(makeTask());

      expect(result.issueKey).toBe("TEST-1");
      expect(result.issueUrl).toBe("https://test.atlassian.net/browse/TEST-1");
      expect(result.refinedTitle).toBe("Refined Task");
    });

    it("throws when Jira config is missing", async () => {
      delete process.env.JIRA_BASE_URL;
      await expect(provider.createIssue(makeTask())).rejects.toThrow("JIRA_BASE_URL");
    });

    it("throws when Jira API returns non-OK", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ issueTypes: [{ name: "Task" }] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: vi.fn().mockResolvedValue("Bad Request"),
        });

      await expect(provider.createIssue(makeTask())).rejects.toThrow("Jira API error 400");
    });

    it("falls back to Task when requested issue type is unavailable", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ issueTypes: [{ name: "Task" }, { name: "Bug" }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ key: "TEST-2", self: "..." }),
        });

      const { refineRequirements } = await import("@/lib/agents/requirements-agent");
      vi.mocked(refineRequirements).mockResolvedValueOnce({
        title: "Spike Task",
        issueType: "Spike",
        description: "desc",
        acceptanceCriteria: [],
        priority: "P2",
        labels: [],
        assignee: null,
      });

      const result = await provider.createIssue(makeTask());
      expect(result.issueKey).toBe("TEST-2");

      const createCall = mockFetch.mock.calls[1];
      const body = JSON.parse(createCall[1].body);
      expect(body.fields.issuetype.name).toBe("Task");
    });
  });

  describe("checkForDuplicates", () => {
    it("finds similar issues above 0.7 threshold", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          issues: [
            { key: "TEST-1", fields: { summary: "Ship webhook integration" } },
            { key: "TEST-2", fields: { summary: "Completely different task" } },
          ],
        }),
      });

      const result = await provider.checkForDuplicates(
        "Ship webhook integration",
        "TEST"
      );

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].similarity).toBeGreaterThan(0.7);
    });

    it("returns empty array when API fails", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const result = await provider.checkForDuplicates("Some task", "TEST");
      expect(result).toEqual([]);
    });

    it("returns empty array when no matches", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          issues: [{ key: "TEST-1", fields: { summary: "Totally unrelated" } }],
        }),
      });

      const result = await provider.checkForDuplicates(
        "Add retry logic to webhook pipeline",
        "TEST"
      );
      expect(result).toEqual([]);
    });
  });

  describe("retryFailedIssue", () => {
    it("throws when task is not in jira_failed status", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: makeTask({ status: "completed" }),
              error: null,
            }),
          }),
        }),
      });

      await expect(provider.retryFailedIssue("task-1")).rejects.toThrow("not in jira_failed");
    });

    it("throws when task is not found", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
          }),
        }),
      });

      await expect(provider.retryFailedIssue("nonexistent")).rejects.toThrow("Task not found");
    });
  });
});
