import { generateText, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { searchPlanSchema, type SearchPlan } from "./schemas";

const INSTRUCTIONS = `You generate targeted code-search queries for a software task.
Rules:
- Return 2-6 concise search queries.
- Prefer concrete symbols, filenames, endpoints, class/function names, and domain nouns.
- Avoid verbose prose.
- Optionally include up to 5 likely target paths.
- Do not invent certainty; keep rationale brief.`;

export async function generateSearchPlan(input: {
  title: string;
  description: string;
  labels: string[];
}): Promise<SearchPlan> {
  const prompt = `Task title: ${input.title}
Task description: ${input.description}
Labels: ${input.labels.join(", ") || "none"}

Generate focused code-search queries.`;

  const { output } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: INSTRUCTIONS,
    prompt,
    output: Output.object({ schema: searchPlanSchema }),
  });

  if (!output) {
    return {
      queries: [input.title, ...input.labels.filter(Boolean)].slice(0, 2),
      rationale: "Fallback from task metadata",
    };
  }

  return output;
}
