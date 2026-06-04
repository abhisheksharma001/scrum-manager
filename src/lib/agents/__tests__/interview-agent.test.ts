import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      update: mockUpdate,
    })),
  },
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn((config) => config),
  Output: { object: vi.fn() },
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { applyInterviewCompletion } from "../interview-agent";
import type { InterviewMessage } from "../interview-agent";
import type { InterviewCompletion } from "../schemas";

describe("applyInterviewCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds correct Q/A responses from alternating chat history", async () => {
    const history: InterviewMessage[] = [
      { role: "assistant", content: "Who should own this?" },
      { role: "user", content: "Alex should own it" },
      { role: "assistant", content: "What's the deadline?" },
      { role: "user", content: "End of sprint" },
    ];

    const completion: InterviewCompletion = {
      title: "Ship webhook",
      description: "Full description",
      assignee: "Alex",
      priority: "P1",
      labels: ["backend"],
      should_create: true,
    };

    await applyInterviewCompletion("task-1", completion, history);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.interview_responses).toEqual({
      "Who should own this?": "Alex should own it",
      "What's the deadline?": "End of sprint",
    });
  });

  it("handles odd-length history with empty answer for last question", async () => {
    const history: InterviewMessage[] = [
      { role: "assistant", content: "Who should own this?" },
      { role: "user", content: "Alex" },
      { role: "assistant", content: "What's the priority?" },
    ];

    const completion: InterviewCompletion = {
      title: "Task",
      description: "Desc",
      assignee: "Alex",
      priority: "P2",
      labels: [],
      should_create: true,
    };

    await applyInterviewCompletion("task-2", completion, history);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.interview_responses["What's the priority?"]).toBe("");
  });

  it("sets task to dismissed when should_create is false", async () => {
    const completion: InterviewCompletion = {
      title: "Not real",
      description: "Already handled in another ticket",
      assignee: null,
      priority: "P2",
      labels: [],
      should_create: false,
    };

    await applyInterviewCompletion("task-3", completion, []);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.status).toBe("dismissed");
    expect(updateCall.dismissed_reason).toBe("Already handled in another ticket");
  });

  it("sets task to pending_repo_analysis when should_create is true for code work", async () => {
    const completion: InterviewCompletion = {
      title: "Refined title",
      description: "Refined description",
      assignee: "Jordan",
      workType: "code",
      priority: "P1",
      labels: ["frontend"],
      should_create: true,
    };

    await applyInterviewCompletion("task-4", completion, []);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.status).toBe("pending_repo_analysis");
    expect(updateCall.extracted_title).toBe("Refined title");
    expect(updateCall.extracted_description).toBe("Refined description");
    expect(updateCall.priority).toBe("P1");
    expect(updateCall.labels).toEqual(["frontend"]);
  });

  it("sets inferred_assignees when assignee is provided", async () => {
    const completion: InterviewCompletion = {
      title: "Task",
      description: "Desc",
      assignee: "Alex",
      priority: "P2",
      labels: [],
      should_create: true,
    };

    await applyInterviewCompletion("task-5", completion, []);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.inferred_assignees).toEqual([{ name: "Alex", email: undefined }]);
  });

  it("leaves inferred_assignees undefined when no assignee", async () => {
    const completion: InterviewCompletion = {
      title: "Task",
      description: "Desc",
      assignee: null,
      priority: "P2",
      labels: [],
      should_create: true,
    };

    await applyInterviewCompletion("task-6", completion, []);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.inferred_assignees).toBeUndefined();
  });
});
