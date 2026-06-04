import { z } from "zod";
import { ValidationError } from "./errors";

export const prioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const workTypeSchema = z.enum(["code", "non_code", "unclear"]);

// ─── Route Input Schemas ─────────────────────────────────────────────────────

export const pushJiraBody = z.object({
  projectKey: z.string().min(1).max(20).optional(),
});

export const interviewSaveBody = z.object({
  responses: z.record(z.string(), z.string()),
});

export const interviewCompleteBody = z.object({
  responses: z.record(z.string(), z.string()),
  assignee: z.string().optional(),
  developerName: z.string().optional(),
  developerEmail: z.string().email().optional(),
  projectKey: z.string().min(1).max(20).optional(),
  repoNames: z.array(z.string().min(1)).optional(),
  workType: workTypeSchema.optional(),
  priority: prioritySchema.optional(),
  labels: z.array(z.string()).optional(),
});

export const interviewDismissBody = z.object({
  reason: z.string().optional(),
});

export const aiInterviewBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("reply"),
    message: z.string().min(1),
    history: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    ),
  }),
]);

export const voiceCompleteBody = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  assignee: z.string().optional(),
  priority: prioritySchema.optional(),
  labels: z.array(z.string()).optional(),
  should_create: z.boolean(),
  transcript: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
});

export const configUpdateBody = z.object({
  value: z.unknown().refine((v) => v !== undefined, "value is required"),
});

export const listQuery = z.object({
  status: z.string().optional(),
  transcriptId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse and validate arbitrary data against a Zod schema; throws `ValidationError` on failure. */
export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i: z.core.$ZodIssue) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ValidationError(message);
  }
  return result.data;
}

/** Convenience wrapper for the common list-endpoint query params. */
export function parseListQuery(
  searchParams: URLSearchParams
): z.infer<typeof listQuery> {
  return parseBody(listQuery, {
    status: searchParams.get("status") || undefined,
    transcriptId: searchParams.get("transcriptId") || undefined,
    limit: searchParams.get("limit") || 50,
  });
}
