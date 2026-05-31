"use client";

import { useEffect, useState } from "react";

interface Brief {
  id: string;
  task_id: string;
  status: string;
  confidence: string | null;
  brief: {
    task_name?: string;
    task_restated?: string;
    files_likely_involved?: Array<{ path: string; reason: string }>;
    suggested_approach?: string[];
    suggested_tests?: string[];
    execution_pack?: {
      plain_language_logic: string[];
      technical_logic: Array<{ area: string; change: string; notes?: string }>;
      implementation_steps: string[];
      code_guidance: Array<{ file: string | null; guidance: string; example?: string }>;
      tests_to_run: string[];
      agent_prompt: string;
    };
  } | null;
  created_at: string;
}

function fallbackAgentPrompt(brief: NonNullable<Brief["brief"]>, taskId: string) {
  const files = brief.files_likely_involved?.length
    ? brief.files_likely_involved.map((file) => `- ${file.path}`).join("\n")
    : "- [verify relevant files]";
  const steps = brief.suggested_approach?.length
    ? brief.suggested_approach.map((step, index) => `${index + 1}. ${step}`).join("\n")
    : "1. Read the task and relevant files, then make the smallest safe implementation.";
  const tests = brief.suggested_tests?.length
    ? brief.suggested_tests.map((test) => `- ${test}`).join("\n")
    : "- Run the smallest relevant test suite for the touched area.";

  return `You are working in the Tandem codebase.

Goal:
${brief.task_restated || `Complete task ${taskId}.`}

Read these files first:
${files}

Implementation logic:
${steps}

Constraints:
- Keep the change focused on the task.
- Do not rewrite unrelated code.
- Follow existing project patterns.
- Treat this brief as guidance, not final code.

Tests to run:
${tests}`;
}

export default function BriefsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/briefs");
    const data = await res.json();
    setBriefs(data.briefs || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (id: string, action: "approve" | "reject" | "regenerate" | "send") => {
    await fetch(`/api/briefs/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" } });
    await load();
  };

  const copyPrompt = async (brief: Brief) => {
    if (!brief.brief) return;
    const prompt = brief.brief.execution_pack?.agent_prompt || fallbackAgentPrompt(brief.brief, brief.task_id);
    await navigator.clipboard.writeText(prompt);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Developer Prompt Packs</h1>
        <p className="text-[13px] text-[var(--foreground-secondary)] mt-1">
          Review repo-aware implementation logic and copy-paste coding-agent prompts.
        </p>
      </div>
      {loading ? (
        <div className="h-24 skeleton rounded-xl" />
      ) : briefs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-[13px] text-[var(--foreground-tertiary)]">
          No briefs yet.
        </div>
      ) : (
        <div className="space-y-2">
          {briefs.map((b) => (
            <div key={b.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-[14px] font-medium">{b.brief?.task_name || `Task ${b.task_id}`}</p>
                  <p className="text-[12px] text-[var(--foreground-tertiary)] mt-1">
                    Status: {b.status} {b.confidence ? `• Confidence: ${b.confidence}` : ""}
                  </p>
                  {b.brief?.task_restated && (
                    <p className="mt-2 break-words text-[13px] text-[var(--foreground-secondary)]">{b.brief.task_restated}</p>
                  )}
                  {b.brief && (
                    <div className="mt-4 space-y-4 text-[13px]">
                      <section>
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Plain Logic</h2>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--foreground-secondary)]">
                          {(b.brief.execution_pack?.plain_language_logic || [b.brief.task_restated || "Review the task and implement the smallest safe change."]).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </section>

                      <section>
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Technical Logic</h2>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--foreground-secondary)]">
                          {(b.brief.execution_pack?.technical_logic || (b.brief.suggested_approach || []).map((step, idx) => ({ area: `Step ${idx + 1}`, change: step, notes: undefined }))).map((item, idx) => (
                            <li key={idx}>
                              <span className="font-medium text-[var(--foreground)]">{item.area}:</span> {item.change}
                              {item.notes ? ` (${item.notes})` : ""}
                            </li>
                          ))}
                        </ul>
                      </section>

                      {b.brief.execution_pack?.code_guidance?.length ? (
                        <section>
                          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Code Guidance</h2>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--foreground-secondary)]">
                            {b.brief.execution_pack.code_guidance.map((item, idx) => (
                              <li key={idx}>
                                <span className="font-mono text-[12px] text-[var(--foreground)]">{item.file || "General"}</span>: {item.guidance}
                                {item.example ? <pre className="mt-1 overflow-x-auto rounded-md bg-[var(--background-secondary)] p-2 text-[11px]">{item.example}</pre> : null}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}

                      <section>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Codex / Claude Code Prompt</h2>
                          <button className="rounded-md border px-2.5 py-1 text-[11px]" onClick={() => copyPrompt(b)}>Copy Prompt</button>
                        </div>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--background-secondary)] p-3 text-[12px] leading-relaxed text-[var(--foreground-secondary)]">
                          {b.brief.execution_pack?.agent_prompt || fallbackAgentPrompt(b.brief, b.task_id)}
                        </pre>
                      </section>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                  <button className="rounded-md border px-2.5 py-1.5 text-[11px]" onClick={() => act(b.id, "approve")}>Approve</button>
                  <button className="rounded-md border px-2.5 py-1.5 text-[11px]" onClick={() => act(b.id, "reject")}>Reject</button>
                  <button className="rounded-md border px-2.5 py-1.5 text-[11px]" onClick={() => act(b.id, "regenerate")}>Regenerate</button>
                  <button className="rounded-md border px-2.5 py-1.5 text-[11px]" onClick={() => act(b.id, "send")}>Send</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
