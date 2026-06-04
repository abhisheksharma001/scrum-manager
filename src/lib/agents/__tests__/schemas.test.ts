import { describe, it, expect } from "vitest";
import {
  extractionOutputSchema,
  extractedTaskSchema,
  interviewCompletionSchema,
  requirementsOutputSchema,
  routingOutputSchema,
  developerBriefSchema,
  confidenceSchema,
  prioritySchema,
} from "../schemas";

const validTask = {
  title: "Ship webhook integration",
  description: "Implement the AppFolio webhook handler with retry logic",
  inferredAssignees: [{ name: "Alex", email: "alex@example.com" }],
  confidence: "high" as const,
  workType: "code" as const,
  repoContextNeeded: true,
  missingContext: ["What's the deadline?"],
  sourceQuotes: [{ speaker: "Alex", text: "Alex said he'd ship it by Friday", timestamp: 65 }],
  priority: "P1" as const,
  labels: ["backend", "integration"],
  suggestedInterviewer: { name: "Alex", email: "alex@example.com" },
};

describe("extractionOutputSchema", () => {
  it("parses a valid extraction output", () => {
    const input = { tasks: [validTask] };
    const result = extractionOutputSchema.parse(input);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("Ship webhook integration");
  });

  it("accepts empty tasks array", () => {
    const result = extractionOutputSchema.parse({ tasks: [] });
    expect(result.tasks).toEqual([]);
  });

  it("rejects missing tasks field", () => {
    expect(() => extractionOutputSchema.parse({})).toThrow();
  });

  it("rejects task with missing required title", () => {
    const { title, ...noTitle } = validTask;
    expect(() => extractedTaskSchema.parse(noTitle)).toThrow();
  });

  it("rejects task with missing description", () => {
    const { description, ...noDesc } = validTask;
    expect(() => extractedTaskSchema.parse(noDesc)).toThrow();
  });
});

describe("confidenceSchema", () => {
  it.each(["high", "medium", "low"] as const)("accepts '%s'", (value) => {
    expect(confidenceSchema.parse(value)).toBe(value);
  });

  it("rejects invalid confidence level", () => {
    expect(() => confidenceSchema.parse("very-high")).toThrow();
  });
});

describe("prioritySchema", () => {
  it.each(["P0", "P1", "P2", "P3"] as const)("accepts '%s'", (value) => {
    expect(prioritySchema.parse(value)).toBe(value);
  });

  it("rejects invalid priority", () => {
    expect(() => prioritySchema.parse("P4")).toThrow();
  });

  it("rejects lowercase priority", () => {
    expect(() => prioritySchema.parse("p0")).toThrow();
  });
});

describe("interviewCompletionSchema", () => {
  it("parses a valid completion with should_create: true", () => {
    const input = {
      title: "Implement retry logic",
      description: "Add exponential backoff to webhook delivery",
      assignee: "Alex",
      priority: "P1" as const,
      labels: ["backend"],
      should_create: true,
    };
    const result = interviewCompletionSchema.parse(input);
    expect(result.should_create).toBe(true);
    expect(result.assignee).toBe("Alex");
  });

  it("parses a valid dismissal with should_create: false", () => {
    const input = {
      title: "Not a real task",
      description: "This was just casual discussion",
      assignee: null,
      priority: "P2" as const,
      labels: [],
      should_create: false,
    };
    const result = interviewCompletionSchema.parse(input);
    expect(result.should_create).toBe(false);
    expect(result.assignee).toBeNull();
  });

  it("allows null assignee", () => {
    const input = {
      title: "Some task",
      description: "desc",
      assignee: null,
      priority: "P2" as const,
      labels: [],
      should_create: true,
    };
    expect(interviewCompletionSchema.parse(input).assignee).toBeNull();
  });
});

describe("requirementsOutputSchema", () => {
  const validRequirements = {
    title: "Add retry logic to webhooks",
    issueType: "Task" as const,
    description: "Full description here",
    acceptanceCriteria: ["Retries 3 times", "Uses exponential backoff"],
    priority: "P1" as const,
    labels: ["backend"],
    assignee: { name: "Alex", email: "alex@example.com" },
  };

  it("parses a valid requirements output", () => {
    const result = requirementsOutputSchema.parse(validRequirements);
    expect(result.issueType).toBe("Task");
  });

  it.each(["Story", "Task", "Bug", "Spike"] as const)(
    "accepts issueType '%s'",
    (issueType) => {
      const result = requirementsOutputSchema.parse({
        ...validRequirements,
        issueType,
      });
      expect(result.issueType).toBe(issueType);
    }
  );

  it("rejects invalid issueType", () => {
    expect(() =>
      requirementsOutputSchema.parse({ ...validRequirements, issueType: "Epic" })
    ).toThrow();
  });

  it("accepts valid storyPoints on Fibonacci scale", () => {
    for (const sp of ["1", "2", "3", "5", "8", "13"]) {
      const result = requirementsOutputSchema.parse({
        ...validRequirements,
        storyPoints: sp,
      });
      expect(result.storyPoints).toBe(sp);
    }
  });

  it("rejects storyPoints not in Fibonacci set", () => {
    expect(() =>
      requirementsOutputSchema.parse({ ...validRequirements, storyPoints: "4" })
    ).toThrow();
  });

  it("allows null assignee", () => {
    const result = requirementsOutputSchema.parse({
      ...validRequirements,
      assignee: null,
    });
    expect(result.assignee).toBeNull();
  });

  it("accepts optional blockedBy", () => {
    const result = requirementsOutputSchema.parse({
      ...validRequirements,
      blockedBy: ["ENG-123", "AUTH-456"],
    });
    expect(result.blockedBy).toEqual(["ENG-123", "AUTH-456"]);
  });
});

describe("routingOutputSchema", () => {
  it("parses valid routing output", () => {
    const input = {
      projectKey: "ENG",
      reasoning: "This is a backend engineering task",
    };
    const result = routingOutputSchema.parse(input);
    expect(result.projectKey).toBe("ENG");
    expect(result.reasoning).toBe("This is a backend engineering task");
  });

  it("rejects missing projectKey", () => {
    expect(() =>
      routingOutputSchema.parse({ reasoning: "some reason" })
    ).toThrow();
  });

  it("rejects missing reasoning", () => {
    expect(() =>
      routingOutputSchema.parse({ projectKey: "ENG" })
    ).toThrow();
  });
});

describe("developerBriefSchema", () => {
  const validBrief = {
    task_name: "Improve repo retrieval",
    assignee: "Alex",
    tracker_key: "ENG-123",
    tracker_url: "https://jira.example/browse/ENG-123",
    repos: ["ellavox-ai/Tandem"],
    files_likely_involved: [
      { path: "src/lib/services/repo-analysis.ts", reason: "Owns the retrieval pipeline" },
    ],
    existing_code_summary: "The current pipeline searches GitHub and fetches full candidate files.",
    task_restated: "Make repo analysis cheaper and easier for a coding agent to execute.",
    suggested_approach: ["Add an execution pack to the generated brief"],
    key_considerations: ["Keep v1 brief-only and read-only"],
    risks: ["The agent prompt could become too generic if not grounded in files"],
    estimated_complexity: { level: "small" as const, rationale: "Mostly schema and rendering changes" },
    dependencies: ["Vercel AI SDK structured output"],
    suggested_tests: ["Run schema validation tests"],
    execution_pack: {
      plain_language_logic: ["Give developers instructions and a prompt, not a code dump."],
      technical_logic: [
        {
          area: "Brief schema",
          change: "Add execution_pack with implementation logic and agent_prompt",
        },
      ],
      implementation_steps: ["Update schema", "Render execution pack"],
      code_guidance: [
        {
          file: "src/lib/agents/schemas.ts",
          guidance: "Keep the prompt pack structured so delivery renderers can reuse it.",
          example: "execution_pack: executionPackSchema",
        },
      ],
      tests_to_run: ["pnpm test -- schemas"],
      agent_prompt:
        "You are working in the Tandem codebase. Read the Scrum Relief brief schema and rendering files first. Implement an execution pack that includes plain-language logic, technical logic, tests, and a copy-paste coding-agent prompt. Keep the change brief-only, read-only, and focused. Run the relevant schema and TypeScript tests before finishing.",
    },
    confidence: "high" as const,
    missing_info: [],
  };

  it("requires an execution pack with a copy-paste agent prompt", () => {
    const result = developerBriefSchema.parse(validBrief);
    expect(result.execution_pack.agent_prompt).toContain("Tandem codebase");
  });

  it("rejects brief output without execution_pack", () => {
    const { execution_pack: _executionPack, ...withoutPack } = validBrief;
    expect(() => developerBriefSchema.parse(withoutPack)).toThrow();
  });
});
