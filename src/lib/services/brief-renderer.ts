import type { DeveloperBrief } from "@/lib/types";

type ExecutionPack = NonNullable<DeveloperBrief["execution_pack"]>;

const DISCLAIMER =
  "This is a starting brief generated from read-only repo analysis, not final code. Verify before implementing.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function list(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- None captured"];
}

function fallbackExecutionPack(brief: DeveloperBrief): ExecutionPack {
  const files = brief.files_likely_involved.map((file) => file.path);
  const filesSection = files.length > 0 ? files.map((file) => `- ${file}`).join("\n") : "- [verify relevant files]";
  const testsSection =
    brief.suggested_tests.length > 0
      ? brief.suggested_tests.map((test) => `- ${test}`).join("\n")
      : "- Add or run the smallest relevant tests for the touched area.";

  return {
    plain_language_logic: [
      brief.task_restated,
      "Use the listed repository files as the starting point, then make the smallest implementation that satisfies the task.",
    ].filter(Boolean),
    technical_logic: brief.suggested_approach.map((step, index) => ({
      area: index === 0 ? "Primary implementation" : `Step ${index + 1}`,
      change: step,
    })),
    implementation_steps: brief.suggested_approach,
    code_guidance: [],
    tests_to_run: brief.suggested_tests,
    agent_prompt: `You are working in the repository for this task.

Goal:
${brief.task_restated}

Read these files first:
${filesSection}

Implementation logic:
${brief.suggested_approach.map((step, index) => `${index + 1}. ${step}`).join("\n")}

Constraints:
- Keep the change focused on the task.
- Do not rewrite unrelated code.
- Follow the existing project patterns.
- Treat this brief as guidance, not final code.

Tests to run:
${testsSection}`,
  };
}

export function getExecutionPack(brief: DeveloperBrief): ExecutionPack {
  return brief.execution_pack ?? fallbackExecutionPack(brief);
}

export function renderBriefPlainText(brief: DeveloperBrief, trackerUrl: string | null): string {
  const pack = getExecutionPack(brief);
  const lines = [
    `Developer execution brief: ${brief.task_name}`,
    `Tracker: ${brief.tracker_key ?? "N/A"}`,
    trackerUrl ? `Issue: ${trackerUrl}` : "",
    `Confidence: ${brief.confidence}`,
    "",
    "What this task is asking:",
    brief.task_restated,
    "",
    "Files likely involved:",
    ...list(brief.files_likely_involved.map((file) => `${file.path} - ${file.reason}`)),
    "",
    "Plain-language implementation logic:",
    ...list(pack.plain_language_logic),
    "",
    "Technical implementation logic:",
    ...pack.technical_logic.flatMap((item) => [
      `- ${item.area}: ${item.change}${item.notes ? ` (${item.notes})` : ""}`,
    ]),
    "",
    "Implementation steps:",
    ...pack.implementation_steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Small code guidance:",
    ...(pack.code_guidance.length > 0
      ? pack.code_guidance.flatMap((item) => [
          `- ${item.file ?? "General"}: ${item.guidance}`,
          item.example ? `  Example: ${item.example}` : "",
        ])
      : ["- No snippets needed; use the logic and file references above."]),
    "",
    "Tests to run:",
    ...list(pack.tests_to_run),
    "",
    "Copy-paste prompt for Codex / Claude Code:",
    pack.agent_prompt,
    "",
    DISCLAIMER,
  ];

  return lines.join("\n");
}

export function renderBriefHtml(brief: DeveloperBrief, trackerUrl: string | null): string {
  const pack = getExecutionPack(brief);
  const bulletList = (items: string[]) =>
    `<ul>${(items.length > 0 ? items : ["None captured"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;

  return `
  <h2>${escapeHtml(brief.task_name)}</h2>
  <p><strong>Tracker:</strong> ${escapeHtml(brief.tracker_key ?? "N/A")}</p>
  <p><strong>Confidence:</strong> ${escapeHtml(brief.confidence)}</p>
  <h3>What this task is asking</h3>
  <p>${escapeHtml(brief.task_restated)}</p>
  <h3>Files likely involved</h3>
  ${bulletList(brief.files_likely_involved.map((file) => `${file.path} - ${file.reason}`))}
  <h3>Plain-language implementation logic</h3>
  ${bulletList(pack.plain_language_logic)}
  <h3>Technical implementation logic</h3>
  ${bulletList(pack.technical_logic.map((item) => `${item.area}: ${item.change}${item.notes ? ` (${item.notes})` : ""}`))}
  <h3>Implementation steps</h3>
  ${bulletList(pack.implementation_steps)}
  <h3>Small code guidance</h3>
  ${
    pack.code_guidance.length > 0
      ? bulletList(pack.code_guidance.map((item) => `${item.file ?? "General"}: ${item.guidance}${item.example ? ` Example: ${item.example}` : ""}`))
      : bulletList(["No snippets needed; use the logic and file references above."])
  }
  <h3>Tests to run</h3>
  ${bulletList(pack.tests_to_run)}
  <h3>Copy-paste prompt for Codex / Claude Code</h3>
  <pre style="white-space:pre-wrap;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:12px;">${escapeHtml(pack.agent_prompt)}</pre>
  <p>${escapeHtml(DISCLAIMER)}</p>
  ${trackerUrl ? `<p><a href="${escapeHtml(trackerUrl)}">Open tracker issue</a></p>` : ""}
  `;
}
