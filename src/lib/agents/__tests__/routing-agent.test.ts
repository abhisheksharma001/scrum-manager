import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "pipeline_config") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: mockSelect,
            }),
          }),
        };
      }
      return { update: mockUpdate };
    }),
  },
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn() },
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { routeTaskToProject } from "../routing-agent";
import type { ExtractedTaskRow } from "@/lib/types";
import { generateText } from "ai";

function makeTask(overrides: Partial<ExtractedTaskRow> = {}): ExtractedTaskRow {
  return {
    id: "task-1",
    transcript_id: "t-1",
    extracted_title: "Test Task",
    extracted_description: "A test task",
    work_type: "code",
    repo_context_needed: false,
    approval_status: "approved",
    approved_by: null,
    approved_at: null,
    assigned_developer_name: null,
    assigned_developer_email: null,
    repo_confidence: null,
    routing_confidence: null,
    inferred_assignees: [],
    confidence: "high",
    missing_context: [],
    source_quotes: [],
    priority: "P2",
    labels: ["backend"],
    status: "auto_created",
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

describe("routeTaskToProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JIRA_DEFAULT_PROJECT = "TEST";
  });

  it("returns cached tracker_project when already set", async () => {
    const task = makeTask({ tracker_project: "CACHED" });
    const result = await routeTaskToProject(task);
    expect(result).toBe("CACHED");
  });

  it("returns env default when no routes configured", async () => {
    mockSelect.mockResolvedValue({ data: null });

    const task = makeTask();
    const result = await routeTaskToProject(task);
    expect(result).toBe("TEST");
  });

  it("returns single route's key when only one route configured", async () => {
    mockSelect.mockResolvedValue({
      data: {
        value: [{ projectKey: "ENG", name: "Engineering", routingPrompt: "Backend work" }],
      },
    });

    const task = makeTask();
    const result = await routeTaskToProject(task);
    expect(result).toBe("ENG");
  });

  it("calls AI agent and returns valid projectKey for multiple routes", async () => {
    const routes = [
      { projectKey: "ENG", name: "Engineering", routingPrompt: "Backend" },
      { projectKey: "SALES", name: "Sales", routingPrompt: "CRM work", isDefault: true },
    ];
    mockSelect.mockResolvedValue({ data: { value: routes } });

    vi.mocked(generateText).mockResolvedValue({
      output: { projectKey: "ENG", reasoning: "It's backend work" },
    } as never);

    const task = makeTask();
    const result = await routeTaskToProject(task);
    expect(result).toBe("ENG");
  });

  it("falls back to default route when AI returns invalid key", async () => {
    const routes = [
      { projectKey: "ENG", name: "Engineering", routingPrompt: "Backend" },
      { projectKey: "SALES", name: "Sales", routingPrompt: "CRM", isDefault: true },
    ];
    mockSelect.mockResolvedValue({ data: { value: routes } });

    vi.mocked(generateText).mockResolvedValue({
      output: { projectKey: "INVALID", reasoning: "?" },
    } as never);

    const task = makeTask();
    const result = await routeTaskToProject(task);
    expect(result).toBe("SALES");
  });

  it("falls back to default route when AI call throws", async () => {
    const routes = [
      { projectKey: "ENG", name: "Engineering", routingPrompt: "Backend" },
      { projectKey: "SALES", name: "Sales", routingPrompt: "CRM", isDefault: true },
    ];
    mockSelect.mockResolvedValue({ data: { value: routes } });

    vi.mocked(generateText).mockRejectedValue(new Error("API error"));

    const task = makeTask();
    const result = await routeTaskToProject(task);
    expect(result).toBe("SALES");
  });

  it("falls back to first route when no default is set and AI fails", async () => {
    const routes = [
      { projectKey: "ENG", name: "Engineering", routingPrompt: "Backend" },
      { projectKey: "SALES", name: "Sales", routingPrompt: "CRM" },
    ];
    mockSelect.mockResolvedValue({ data: { value: routes } });

    vi.mocked(generateText).mockResolvedValue({ output: null } as never);

    const task = makeTask();
    const result = await routeTaskToProject(task);
    expect(result).toBe("ENG");
  });

  it("parses JSON string value from pipeline_config", async () => {
    mockSelect.mockResolvedValue({
      data: {
        value: JSON.stringify([
          { projectKey: "DESIGN", name: "Design", routingPrompt: "UI work" },
        ]),
      },
    });

    const task = makeTask();
    const result = await routeTaskToProject(task);
    expect(result).toBe("DESIGN");
  });
});
