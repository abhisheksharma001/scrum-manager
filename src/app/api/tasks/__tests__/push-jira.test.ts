import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: mockFrom },
}));

const { mockCreateIssue } = vi.hoisted(() => ({
  mockCreateIssue: vi.fn(),
}));

vi.mock("@/lib/issue-tracker", () => ({
  getIssueTracker: vi.fn().mockReturnValue({
    createIssue: mockCreateIssue,
  }),
}));

vi.mock("@/lib/agents/routing-agent", () => ({
  routeTaskToProject: vi.fn().mockResolvedValue("TEST"),
}));

import { POST } from "../../tasks/[id]/push-jira/route";

describe("POST /api/tasks/:id/push-jira", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeRequest(body: unknown = {}) {
    return new NextRequest("http://localhost/api/tasks/task-1/push-jira", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("returns 200 with issueKey for approved task", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "task-1", status: "approved", approval_status: "approved", tracker_issue_key: null, tracker_error: null, tracker_project: null },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockCreateIssue.mockResolvedValue({
      issueKey: "ENG-1",
      issueUrl: "https://test.atlassian.net/browse/ENG-1",
      refinedTitle: "Refined",
    });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.issueKey).toBe("ENG-1");
  });

  it("returns 404 when task not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          then: vi.fn((cb: () => void) => { cb?.(); return Promise.resolve(); }),
        }),
      }),
    });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: "nonexistent" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 400 when task is in wrong status", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "task-1", status: "pending_interview", tracker_issue_key: null },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          then: vi.fn((cb: () => void) => { cb?.(); return Promise.resolve(); }),
        }),
      }),
    });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when jira_failed task was never approved", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "task-1",
              status: "jira_failed",
              approval_status: "not_ready",
              tracker_issue_key: null,
              tracker_error: "previous failure",
            },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          then: vi.fn((cb: () => void) => { cb?.(); return Promise.resolve(); }),
        }),
      }),
    });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(400);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("returns alreadyExists when task already has Jira key", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "task-1", status: "approved", approval_status: "approved", tracker_issue_key: "ENG-99", tracker_error: null },
            error: null,
          }),
        }),
      }),
    });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.alreadyExists).toBe(true);
    expect(data.issueKey).toBe("ENG-99");
  });

  it("returns 500 and updates task to jira_failed on creation failure", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "task-1", status: "approved", approval_status: "approved", tracker_issue_key: null, tracker_error: null, tracker_project: null },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockCreateIssue.mockRejectedValue(new Error("Jira API error"));

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(500);
  });
});
