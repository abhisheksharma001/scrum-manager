import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/ai-interview", () => ({
  startAIInterview: vi.fn(),
  continueAIInterview: vi.fn(),
  applyInterviewCompletion: vi.fn(),
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueRepoAnalysis: vi.fn().mockResolvedValue("job-1"),
}));

vi.mock("@/lib/services/developer-brief", () => ({
  createBrief: vi.fn().mockResolvedValue({ id: "brief-1" }),
}));

import { POST } from "../[taskId]/ai-interview/route";
import { startAIInterview, continueAIInterview, applyInterviewCompletion } from "@/lib/services/ai-interview";
import { enqueueRepoAnalysis } from "@/lib/jobs/queue";

const routeContext = { params: Promise.resolve({ taskId: "task-1" }) };

describe("POST /api/interviews/[taskId]/ai-interview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with message for start action", async () => {
    vi.mocked(startAIInterview).mockResolvedValue({
      message: "Hi! Can you tell me who should own this?",
    });

    const request = new NextRequest("http://localhost/api/interviews/task-1/ai-interview", {
      method: "POST",
      body: JSON.stringify({ action: "start" }),
    });

    const response = await POST(request, routeContext);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("Hi! Can you tell me who should own this?");
  });

  it("returns 200 for reply without completion", async () => {
    vi.mocked(continueAIInterview).mockResolvedValue({
      message: "What's the deadline?",
      completion: null,
    });

    const request = new NextRequest("http://localhost/api/interviews/task-1/ai-interview", {
      method: "POST",
      body: JSON.stringify({
        action: "reply",
        message: "Alex should own it",
        history: [
          { role: "assistant", content: "Who owns this?" },
        ],
      }),
    });

    const response = await POST(request, routeContext);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("What's the deadline?");
    expect(data.completion).toBeNull();
  });

  it("applies completion and queues repo analysis when reply finishes for code work", async () => {
    const completion = {
      title: "Ship webhook",
      description: "Full desc",
      assignee: "Alex",
      priority: "P1" as const,
      labels: ["backend"],
      should_create: true,
    };

    vi.mocked(continueAIInterview).mockResolvedValue({
      message: "Thanks, I have everything I need!",
      completion,
    });
    vi.mocked(applyInterviewCompletion).mockResolvedValue({
      id: "task-1",
      work_type: "code",
      repo_context_needed: true,
    } as never);

    const request = new NextRequest("http://localhost/api/interviews/task-1/ai-interview", {
      method: "POST",
      body: JSON.stringify({
        action: "reply",
        message: "End of sprint",
        history: [
          { role: "assistant", content: "Who owns this?" },
          { role: "user", content: "Alex" },
        ],
      }),
    });

    const response = await POST(request, routeContext);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(applyInterviewCompletion).toHaveBeenCalled();
    expect(enqueueRepoAnalysis).toHaveBeenCalledWith({ briefId: "brief-1" });
    expect(data.completion).toEqual(completion);
  });

  it("returns 400 for invalid action", async () => {
    const request = new NextRequest("http://localhost/api/interviews/task-1/ai-interview", {
      method: "POST",
      body: JSON.stringify({ action: "unknown" }),
    });

    const response = await POST(request, routeContext);
    expect(response.status).toBe(400);
  });

  it("returns 400 when reply is missing message", async () => {
    const request = new NextRequest("http://localhost/api/interviews/task-1/ai-interview", {
      method: "POST",
      body: JSON.stringify({
        action: "reply",
        history: [],
      }),
    });

    const response = await POST(request, routeContext);
    expect(response.status).toBe(400);
  });
});
