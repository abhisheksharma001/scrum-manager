import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockFrom, mockSetBriefStatus, mockRecordFeedback, mockEnqueueJiraCreation } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockSetBriefStatus: vi.fn().mockResolvedValue({ id: "brief-1" }),
  mockRecordFeedback: vi.fn().mockResolvedValue({ id: "feedback-1" }),
  mockEnqueueJiraCreation: vi.fn().mockResolvedValue("job-1"),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/lib/services/developer-brief", () => ({
  setBriefStatus: mockSetBriefStatus,
}));

vi.mock("@/lib/learning/store", () => ({
  learningStore: { recordFeedback: mockRecordFeedback },
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJiraCreation: mockEnqueueJiraCreation,
}));

import { POST } from "../[id]/approve/route";

describe("POST /api/briefs/:id/approve", () => {
  beforeEach(() => vi.clearAllMocks());

  function request() {
    return new NextRequest("http://localhost/api/briefs/brief-1/approve", {
      method: "POST",
    });
  }

  it("rejects approval before repo analysis finishes", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "brief-1",
              task_id: "task-1",
              status: "queued",
              brief: null,
              task: {
                status: "pending_repo_analysis",
                approval_status: "not_ready",
                assigned_developer_email: "dev@example.com",
                inferred_assignees: [],
                missing_context: [],
              },
            },
            error: null,
          }),
        }),
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ id: "brief-1" }),
    });

    expect(response.status).toBe(400);
    expect(mockEnqueueJiraCreation).not.toHaveBeenCalled();
  });

  it("routes back to interview when developer email is missing", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "developer_briefs") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "brief-1",
                  task_id: "task-1",
                  status: "awaiting_pm_review",
                  brief: { task_name: "Task" },
                  task: {
                    status: "awaiting_approval",
                    approval_status: "awaiting_approval",
                    assigned_developer_email: null,
                    inferred_assignees: [{ name: "Alex" }],
                    missing_context: ["Which repo?"],
                  },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { update: updateMock };
    });

    const response = await POST(request(), {
      params: Promise.resolve({ id: "brief-1" }),
    });

    expect(response.status).toBe(400);
    expect(updateMock).toHaveBeenCalledWith({
      status: "pending_interview",
      approval_status: "not_ready",
      missing_context: ["Which repo?", "What is the assigned developer's email?"],
    });
    expect(mockEnqueueJiraCreation).not.toHaveBeenCalled();
  });

  it("approves finished brief and queues Jira creation", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "developer_briefs") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "brief-1",
                  task_id: "task-1",
                  status: "awaiting_pm_review",
                  brief: { task_name: "Task" },
                  task: {
                    status: "awaiting_approval",
                    approval_status: "awaiting_approval",
                    assigned_developer_email: "dev@example.com",
                    inferred_assignees: [],
                    missing_context: [],
                  },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { update: updateMock };
    });

    const response = await POST(request(), {
      params: Promise.resolve({ id: "brief-1" }),
    });

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "approved",
        approval_status: "approved",
      })
    );
    expect(mockSetBriefStatus).toHaveBeenCalledWith(
      "brief-1",
      "sending",
      expect.objectContaining({ pm_action: "approve" })
    );
    expect(mockEnqueueJiraCreation).toHaveBeenCalledWith({ taskId: "task-1" });
  });
});
