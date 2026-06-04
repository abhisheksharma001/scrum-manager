import { supabaseAdmin } from "@/lib/supabase";
import type { ExtractedTaskRow, TaskStatus, WorkType } from "@/lib/types";

const CODE_LABELS = new Set([
  "api",
  "backend",
  "bug",
  "code",
  "database",
  "deployment",
  "devops",
  "frontend",
  "github",
  "infrastructure",
  "integration",
  "repo",
  "test",
  "testing",
]);

export function inferWorkType(labels: string[] = [], text = ""): WorkType {
  const normalized = `${labels.join(" ")} ${text}`.toLowerCase();
  if ([...CODE_LABELS].some((label) => normalized.includes(label))) return "code";
  if (/\b(jira|customer|follow[- ]?up|schedule|email|design review|notes|docs?)\b/i.test(normalized)) {
    return "non_code";
  }
  return "unclear";
}

export function hasAssignee(task: Pick<ExtractedTaskRow, "inferred_assignees" | "assigned_developer_email" | "assigned_developer_name">) {
  return Boolean(task.assigned_developer_email || task.assigned_developer_name || task.inferred_assignees?.[0]?.name);
}

export function shouldAnalyzeRepo(task: Pick<ExtractedTaskRow, "work_type" | "repo_context_needed">): boolean {
  return task.work_type === "code" || Boolean(task.repo_context_needed);
}

export function shouldInterviewTask(
  task: Pick<ExtractedTaskRow, "confidence" | "work_type" | "missing_context" | "inferred_assignees" | "assigned_developer_email" | "assigned_developer_name">
): boolean {
  if (task.confidence === "low") return true;
  if (task.work_type === "unclear") return true;
  if (!hasAssignee(task)) return true;
  return (task.missing_context ?? []).length > 0;
}

export async function markTaskAwaitingApproval(taskId: string) {
  const { data, error } = await supabaseAdmin
    .from("extracted_tasks")
    .update({
      status: "awaiting_approval",
      approval_status: "awaiting_approval",
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Failed to mark task awaiting approval");
  return data as ExtractedTaskRow;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, patch: Record<string, unknown> = {}) {
  const { data, error } = await supabaseAdmin
    .from("extracted_tasks")
    .update({ status, ...patch })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error(`Failed to update task status to ${status}`);
  return data as ExtractedTaskRow;
}
