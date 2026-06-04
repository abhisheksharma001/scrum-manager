import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockEq } = vi.hoisted(() => ({
  mockEq: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: mockEq })),
    })),
  },
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJiraCreation: vi.fn().mockResolvedValue("job-1"),
}));

import { POST } from "../[taskId]/voice-complete/route";
import { enqueueJiraCreation } from "@/lib/jobs/queue";

const routeContext = { params: Promise.resolve({ taskId: "task-1" }) };

describe("POST /api/interviews/[taskId]/voice-complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns awaiting_approval action when should_create is true", async () => {
    const request = new NextRequest("http://localhost/api/interviews/task-1/voice-complete", {
      method: "POST",
      body: JSON.stringify({
        title: "Ship webhook integration",
        description: "Full description",
        should_create: true,
        priority: "P1",
      }),
    });

    const response = await POST(request, routeContext);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.action).toBe("awaiting_approval");
    expect(enqueueJiraCreation).not.toHaveBeenCalled();
  });

  it("returns dismissed action when should_create is false", async () => {
    const request = new NextRequest("http://localhost/api/interviews/task-1/voice-complete", {
      method: "POST",
      body: JSON.stringify({
        title: "Not a task",
        description: "Already handled",
        should_create: false,
      }),
    });

    const response = await POST(request, routeContext);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.action).toBe("dismissed");
    expect(enqueueJiraCreation).not.toHaveBeenCalled();
  });

  it("returns 400 when title is missing", async () => {
    const request = new NextRequest("http://localhost/api/interviews/task-1/voice-complete", {
      method: "POST",
      body: JSON.stringify({
        should_create: true,
      }),
    });

    const response = await POST(request, routeContext);
    expect(response.status).toBe(400);
  });

  it("returns 400 when should_create is not boolean", async () => {
    const request = new NextRequest("http://localhost/api/interviews/task-1/voice-complete", {
      method: "POST",
      body: JSON.stringify({
        title: "Task",
        should_create: "yes",
      }),
    });

    const response = await POST(request, routeContext);
    expect(response.status).toBe(400);
  });
});
