import { describe, expect, it } from "vitest";
import { getExecutionPack, renderBriefHtml, renderBriefPlainText } from "../brief-renderer";
import type { DeveloperBrief } from "@/lib/types";

function makeBrief(overrides: Partial<DeveloperBrief> = {}): DeveloperBrief {
  return {
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
    estimated_complexity: { level: "small", rationale: "Mostly schema and rendering changes" },
    dependencies: ["Vercel AI SDK structured output"],
    suggested_tests: ["Run schema validation tests"],
    confidence: "high",
    missing_info: [],
    execution_pack: {
      plain_language_logic: ["Give developers instructions and a prompt, not a code dump."],
      technical_logic: [
        { area: "Brief schema", change: "Add execution_pack with implementation logic and agent_prompt" },
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
    ...overrides,
  };
}

describe("brief renderer", () => {
  it("renders the copy-paste agent prompt in plain text delivery", () => {
    const text = renderBriefPlainText(makeBrief(), "https://jira.example/browse/ENG-123");
    expect(text).toContain("Copy-paste prompt for Codex / Claude Code");
    expect(text).toContain("You are working in the Tandem codebase");
    expect(text).not.toContain("CONTENT:");
  });

  it("escapes prompt content in HTML delivery", () => {
    const html = renderBriefHtml(
      makeBrief({
        execution_pack: {
          ...makeBrief().execution_pack!,
          agent_prompt: "Use <script>alert('x')</script> carefully in examples only.",
        },
      }),
      null
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("falls back for older briefs without execution_pack", () => {
    const legacy = makeBrief({ execution_pack: undefined });
    const pack = getExecutionPack(legacy);
    expect(pack.agent_prompt).toContain("Read these files first");
    expect(pack.agent_prompt).toContain("src/lib/services/repo-analysis.ts");
  });
});
