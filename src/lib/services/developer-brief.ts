import { supabaseAdmin } from "@/lib/supabase";
import { CONFIG_KEYS, type BriefStatus, type DeveloperBriefRow } from "@/lib/types";

export type BriefErrorCode =
  | "no_repo_configured"
  | "github_access_denied"
  | "no_relevant_files"
  | "generation_failed"
  | "delivery_failed";

export async function createBrief(taskId: string, trackerIssueKey?: string | null) {
  const { data: task } = await supabaseAdmin
    .from("extracted_tasks")
    .select("owner_user_id")
    .eq("id", taskId)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from("developer_briefs")
    .upsert(
      {
        task_id: taskId,
        tracker_issue_key: trackerIssueKey ?? null,
        owner_user_id: task?.owner_user_id ?? null,
        status: "queued",
      },
      { onConflict: "task_id" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as DeveloperBriefRow;
}

export async function getBrief(briefId: string): Promise<DeveloperBriefRow> {
  const { data, error } = await supabaseAdmin
    .from("developer_briefs")
    .select("*")
    .eq("id", briefId)
    .single();
  if (error || !data) throw new Error("Brief not found");
  return data as DeveloperBriefRow;
}

export async function listBriefs(status?: BriefStatus): Promise<DeveloperBriefRow[]> {
  let query = supabaseAdmin.from("developer_briefs").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DeveloperBriefRow[];
}

export async function setBriefStatus(
  briefId: string,
  status: BriefStatus,
  patch: Record<string, unknown> = {}
) {
  const { data, error } = await supabaseAdmin
    .from("developer_briefs")
    .update({ status, ...patch })
    .eq("id", briefId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Brief update failed");
  return data as DeveloperBriefRow;
}

export async function getBriefConfig<T>(key: string, fallback: T): Promise<T> {
  const { data } = await supabaseAdmin
    .from("pipeline_config")
    .select("value")
    .eq("key", key)
    .single();
  if (!data?.value) return fallback;
  if (typeof data.value === "string") {
    try {
      return JSON.parse(data.value) as T;
    } catch {
      return data.value as T;
    }
  }
  return data.value as T;
}

export async function getApprovalMode() {
  return getBriefConfig<"gate" | "confidence" | "auto">(CONFIG_KEYS.BRIEF_APPROVAL_MODE, "gate");
}
