import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockFrom, mockEnqueueJiraCreation } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockEnqueueJiraCreation: vi.fn().mockResolvedValue("job-1"),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJiraCreation: mockEnqueueJiraCreation,
}));

import { POST } from "../[id]/retry-jira/route";

describe("POST /api/tasks/:id/retry-jira", () => {
  beforeEach(() => vi.clearAllMocks());

  function request() {
    return new NextRequest("http://localhost/api/tasks/task-1/retry-jira", {
      method: "POST",
    });
  }

  it("rejects retry when failed task was not approved", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "task-1",
              status: "jira_failed",
              approval_status: "not_ready",
              tracker_project: "ENG",
            },
            error: null,
          }),
        }),
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(400);
    expect(mockEnqueueJiraCreation).not.toHaveBeenCalled();
  });

  it("enqueues retry for approved failed task", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "task-1",
              status: "jira_failed",
              approval_status: "approved",
              tracker_project: "ENG",
            },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const response = await POST(request(), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(200);
    expect(mockEnqueueJiraCreation).toHaveBeenCalledWith({
      taskId: "task-1",
      projectKey: "ENG",
    });
  });
});
