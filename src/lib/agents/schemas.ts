import { z } from "zod";

export const assigneeSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
});

export const sourceQuoteSchema = z.object({
  speaker: z.string().describe("Name of the person who said this"),
  text: z.string(),
  timestamp: z.number(),
});

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export const prioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

// ─── Extraction Agent Output ────────────────────────────────────────────────

export const extractedTaskSchema = z.object({
  title: z.string().describe("Concise, actionable title in imperative mood"),
  description: z
    .string()
    .describe("Full context from the discussion — what, why, constraints"),
  inferredAssignees: z.array(assigneeSchema),
  confidence: confidenceSchema,
  missingContext: z
    .array(z.string())
    .describe("Specific questions that couldn't be answered from the transcript"),
  sourceQuotes: z.array(sourceQuoteSchema),
  priority: prioritySchema,
  labels: z.array(z.string()),
  suggestedInterviewer: assigneeSchema
    .nullable()
    .describe("The meeting participant best suited to clarify this task in an interview"),
});

export const extractionOutputSchema = z.object({
  tasks: z.array(extractedTaskSchema),
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

// ─── Interview Completion Output ────────────────────────────────────────────

export const interviewCompletionSchema = z.object({
  title: z.string().describe("Refined task title"),
  description: z.string().describe("Full task description with gathered context"),
  assignee: z.string().nullable().describe("Person name or null"),
  priority: prioritySchema,
  labels: z.array(z.string()),
  should_create: z.boolean().describe("Whether the task should be created in Jira"),
});

export type InterviewCompletion = z.infer<typeof interviewCompletionSchema>;

// ─── Requirements Agent Output ──────────────────────────────────────────────

export const requirementsOutputSchema = z.object({
  title: z.string().describe("Concise, actionable Jira issue summary"),
  issueType: z.enum(["Story", "Task", "Bug", "Spike"]),
  description: z
    .string()
    .describe("Rich description formatted for Jira with full context"),
  acceptanceCriteria: z
    .array(z.string())
    .describe("Testable acceptance criteria items"),
  technicalNotes: z
    .string()
    .optional()
    .describe("Implementation hints, architecture considerations"),
  storyPoints: z
    .enum(["1", "2", "3", "5", "8", "13"])
    .optional()
    .describe("Estimated complexity"),
  priority: prioritySchema,
  labels: z.array(z.string()),
  assignee: assigneeSchema.nullable(),
  blockedBy: z
    .array(z.string())
    .optional()
    .describe("Known dependencies or blockers"),
});

export type RequirementsOutput = z.infer<typeof requirementsOutputSchema>;

// ─── Routing Agent Output ───────────────────────────────────────────────────

export const routingOutputSchema = z.object({
  projectKey: z.string().describe("The Jira project key to route this task to"),
  reasoning: z.string().describe("Brief explanation of why this project was chosen"),
});

export type RoutingOutput = z.infer<typeof routingOutputSchema>;

// ─── Scrum Relief Output Schemas ────────────────────────────────────────────

export const searchPlanSchema = z.object({
  queries: z.array(z.string().min(1)).min(2).max(6),
  target_paths: z.array(z.string()).max(5).optional(),
  rationale: z.string().max(500),
});

export const briefFileSchema = z.object({
  path: z.string(),
  reason: z.string(),
});

export const executionPackSchema = z.object({
  plain_language_logic: z.array(z.string()).min(1),
  technical_logic: z
    .array(
      z.object({
        area: z.string(),
        change: z.string(),
        notes: z.string().optional(),
      })
    )
    .min(1),
  implementation_steps: z.array(z.string()).min(1),
  code_guidance: z
    .array(
      z.object({
        file: z.string().nullable(),
        guidance: z.string(),
        example: z.string().optional(),
      })
    )
    .max(6),
  tests_to_run: z.array(z.string()).min(1),
  agent_prompt: z.string().min(200),
});

export const developerBriefSchema = z.object({
  task_name: z.string(),
  assignee: z.string().nullable(),
  tracker_key: z.string().nullable(),
  tracker_url: z.string().nullable(),
  repos: z.array(z.string()),
  files_likely_involved: z.array(briefFileSchema),
  existing_code_summary: z.string(),
  task_restated: z.string(),
  suggested_approach: z.array(z.string()),
  key_considerations: z.array(z.string()),
  risks: z.array(z.string()),
  estimated_complexity: z.object({
    level: z.enum(["trivial", "small", "medium", "large", "unknown"]),
    rationale: z.string(),
  }),
  dependencies: z.array(z.string()),
  suggested_tests: z.array(z.string()),
  execution_pack: executionPackSchema,
  sample_snippets: z
    .array(
      z.object({
        path: z.string().nullable(),
        language: z.string(),
        code: z.string(),
        purpose: z.string(),
      })
    )
    .max(3)
    .optional(),
  confidence: z.enum(["high", "medium", "low", "none"]),
  missing_info: z.array(z.string()),
});

export type SearchPlan = z.infer<typeof searchPlanSchema>;
export type DeveloperBriefOutput = z.infer<typeof developerBriefSchema>;
