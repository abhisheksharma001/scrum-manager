import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/interview-queue", () => ({
  completeInterview: vi.fn(),
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueRepoAnalysis: vi.fn().mockResolvedValue("job-1"),
}));

vi.mock("@/lib/services/notifications", () => ({
  notifyInterviewCompleted: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../[taskId]/complete/route";
import { completeInterview } from "@/lib/services/interview-queue";
import { enqueueRepoAnalysis } from "@/lib/jobs/queue";

vi.mock("@/lib/services/developer-brief", () => ({
  createBrief: vi.fn().mockResolvedValue({ id: "brief-1" }),
}));

const routeContext = { params: Promise.resolve({ taskId: "task-1" }) };

describe("POST /api/interviews/[taskId]/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with task and queues repo analysis for code work", async () => {
    const mockTask = { id: "task-1", status: "pending_repo_analysis", work_type: "code", repo_context_needed: true };
    vi.mocked(completeInterview).mockResolvedValue(mockTask as never);

    const request = new NextRequest("http://localhost/api/interviews/task-1/complete", {
      method: "POST",
      body: JSON.stringify({
        responses: { "Q1": "A1" },
        assignee: "Alex",
        priority: "P1",
      }),
    });

    const response = await POST(request, routeContext);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toEqual(mockTask);
    expect(enqueueRepoAnalysis).toHaveBeenCalledWith({ briefId: "brief-1" });
  });

  it("returns 400 when responses field is missing", async () => {
    const request = new NextRequest("http://localhost/api/interviews/task-1/complete", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(request, routeContext);
    expect(response.status).toBe(400);
  });
});
