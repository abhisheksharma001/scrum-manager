import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import type {
  Confidence,
  ExtractedTaskRow,
  LearningCorrections,
  LearningFeedbackEventRow,
  LearningFeedbackType,
  LearningMemoryRow,
  LearningMemoryStatus,
  LearningMemoryType,
  LearningScope,
  RoutingDecisionRow,
} from "@/lib/types";

export interface FeedbackInput {
  ownerUserId: string;
  taskId?: string | null;
  briefId?: string | null;
  eventType: LearningFeedbackType;
  scope: LearningScope;
  note?: string | null;
  corrections?: LearningCorrections;
  confidence?: Confidence;
}

export interface RoutingDecisionInput {
  ownerUserId: string;
  taskId: string;
  projectKey?: string | null;
  repoMatches?: RoutingDecisionRow["repo_matches"];
  assignee?: string | null;
  pathMatches?: RoutingDecisionRow["path_matches"];
  confidence: number;
  source: RoutingDecisionRow["source"];
  explanation: string;
  alternatives?: RoutingDecisionRow["alternatives"];
  needsReview?: boolean;
}

export interface LearningStore {
  recordFeedback(input: FeedbackInput): Promise<LearningFeedbackEventRow>;
  listMemories(ownerUserId: string, status?: LearningMemoryStatus): Promise<LearningMemoryRow[]>;
  updateMemory(
    ownerUserId: string,
    memoryId: string,
    patch: Partial<Pick<LearningMemoryRow, "status" | "pattern" | "target" | "confidence">>
  ): Promise<LearningMemoryRow>;
  recordRoutingDecision(input: RoutingDecisionInput): Promise<RoutingDecisionRow | null>;
  getLatestRoutingDecision(taskId: string): Promise<RoutingDecisionRow | null>;
  findTaskOwner(task: Pick<ExtractedTaskRow, "owner_user_id" | "transcript_id">): Promise<string | null>;
}

export class SupabaseLearningStore implements LearningStore {
  async recordFeedback(input: FeedbackInput): Promise<LearningFeedbackEventRow> {
    const previousValues = input.taskId
      ? await getPreviousTaskValues(input.taskId)
      : {};

    const { data, error } = await supabaseAdmin
      .from("learning_feedback_events")
      .insert({
        owner_user_id: input.ownerUserId,
        task_id: input.taskId ?? null,
        brief_id: input.briefId ?? null,
        event_type: input.eventType,
        scope: input.scope,
        note: input.note?.trim() || null,
        corrections: input.corrections ?? {},
        previous_values: previousValues,
        confidence: input.confidence ?? "medium",
      })
      .select("*")
      .single();

    if (error || !data) throw error ?? new Error("Failed to record feedback");

    await applyTaskCorrections(input.taskId, input.corrections);
    await maybeCreateMemory(data as LearningFeedbackEventRow);

    return data as LearningFeedbackEventRow;
  }

  async listMemories(ownerUserId: string, status?: LearningMemoryStatus): Promise<LearningMemoryRow[]> {
    let query = supabaseAdmin
      .from("learning_memories")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .order("updated_at", { ascending: false });

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as LearningMemoryRow[];
  }

  async updateMemory(
    ownerUserId: string,
    memoryId: string,
    patch: Partial<Pick<LearningMemoryRow, "status" | "pattern" | "target" | "confidence">>
  ): Promise<LearningMemoryRow> {
    const allowed: Record<string, unknown> = {};
    if (patch.status) allowed.status = patch.status;
    if (patch.pattern) allowed.pattern = patch.pattern;
    if (patch.target) allowed.target = patch.target;
    if (typeof patch.confidence === "number") allowed.confidence = patch.confidence;

    const { data, error } = await supabaseAdmin
      .from("learning_memories")
      .update(allowed)
      .eq("id", memoryId)
      .eq("owner_user_id", ownerUserId)
      .select("*")
      .single();

    if (error || !data) throw error ?? new Error("Failed to update memory");
    return data as LearningMemoryRow;
  }

  async recordRoutingDecision(input: RoutingDecisionInput): Promise<RoutingDecisionRow | null> {
    const { data, error } = await supabaseAdmin
      .from("task_routing_decisions")
      .insert({
        owner_user_id: input.ownerUserId,
        task_id: input.taskId,
        project_key: input.projectKey ?? null,
        repo_matches: input.repoMatches ?? [],
        assignee: input.assignee ?? null,
        path_matches: input.pathMatches ?? [],
        confidence: input.confidence,
        source: input.source,
        explanation: input.explanation,
        alternatives: input.alternatives ?? [],
        needs_review: Boolean(input.needsReview),
      })
      .select("*")
      .single();

    if (error) return null;
    return data as RoutingDecisionRow;
  }

  async getLatestRoutingDecision(taskId: string): Promise<RoutingDecisionRow | null> {
    const { data } = await supabaseAdmin
      .from("task_routing_decisions")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return (data as RoutingDecisionRow | null) ?? null;
  }

  async findTaskOwner(task: Pick<ExtractedTaskRow, "owner_user_id" | "transcript_id">): Promise<string | null> {
    if (task.owner_user_id) return task.owner_user_id;

    const { data } = await supabaseAdmin
      .from("transcripts")
      .select("owner_user_id")
      .eq("id", task.transcript_id)
      .maybeSingle();

    if (data?.owner_user_id) return data.owner_user_id as string;

    const configured = await getConfigValue<string | null>("default_local_owner_user_id", null);
    return configured || null;
  }
}

export const learningStore: LearningStore = new SupabaseLearningStore();

async function getConfigValue<T>(key: string, fallback: T): Promise<T> {
  const { data } = await supabaseAdmin
    .from("pipeline_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as T) ?? fallback;
}

async function getPreviousTaskValues(taskId: string): Promise<Record<string, unknown>> {
  const { data } = await supabaseAdmin
    .from("extracted_tasks")
    .select("extracted_title, extracted_description, inferred_assignees, priority, labels, tracker_project, assigned_developer_name, assigned_developer_email, work_type")
    .eq("id", taskId)
    .maybeSingle();
  return data ?? {};
}

async function applyTaskCorrections(
  taskId: string | null | undefined,
  corrections: LearningCorrections | undefined
): Promise<void> {
  if (!taskId || !corrections) return;

  const updates: Record<string, unknown> = {};
  if (corrections.title) updates.extracted_title = corrections.title;
  if (corrections.description) updates.extracted_description = corrections.description;
  if (corrections.projectKey) updates.tracker_project = corrections.projectKey.toUpperCase();
  if (corrections.assignee) updates.inferred_assignees = [{ name: corrections.assignee, email: corrections.developerEmail }];
  if (corrections.developerName) updates.assigned_developer_name = corrections.developerName;
  if (corrections.developerEmail) updates.assigned_developer_email = corrections.developerEmail;
  if (corrections.priority) updates.priority = corrections.priority;
  if (corrections.labels) updates.labels = corrections.labels;

  if (Object.keys(updates).length === 0) return;

  await supabaseAdmin.from("extracted_tasks").update(updates).eq("id", taskId);
}

async function maybeCreateMemory(event: LearningFeedbackEventRow): Promise<void> {
  const corrections = event.corrections ?? {};
  const note = event.note?.trim();
  const shouldActivate = event.scope === "teach_system";
  const status: LearningMemoryStatus = shouldActivate ? "active" : "pending";
  const base = {
    owner_user_id: event.owner_user_id,
    source_feedback_event_id: event.id,
    status,
    confidence: event.confidence === "high" ? 0.9 : event.confidence === "medium" ? 0.7 : 0.5,
  };

  const memories: Array<{
    memory_type: LearningMemoryType;
    pattern: string;
    target: Record<string, unknown>;
  }> = [];

  if (corrections.projectKey) {
    memories.push({
      memory_type: "project_route",
      pattern: note || corrections.title || corrections.description || `Route similar work to ${corrections.projectKey}`,
      target: { projectKey: corrections.projectKey.toUpperCase() },
    });
  }
  if (corrections.repoNames?.length) {
    memories.push({
      memory_type: "repo_route",
      pattern: note || corrections.title || corrections.description || `Use ${corrections.repoNames.join(", ")} for similar work`,
      target: { repos: corrections.repoNames },
    });
  }
  if (corrections.paths?.length) {
    memories.push({
      memory_type: "path_route",
      pattern: note || corrections.title || corrections.description || `Use ${corrections.paths.join(", ")} for similar work`,
      target: { paths: corrections.paths },
    });
  }
  if (corrections.assignee) {
    memories.push({
      memory_type: "assignee_preference",
      pattern: note || corrections.title || corrections.description || `Assign similar work to ${corrections.assignee}`,
      target: {
        assignee: corrections.assignee,
        developerName: corrections.developerName ?? corrections.assignee,
        developerEmail: corrections.developerEmail,
      },
    });
  }
  if (corrections.developerEmail && !corrections.assignee) {
    memories.push({
      memory_type: "assignee_preference",
      pattern: note || corrections.title || corrections.description || `Use ${corrections.developerEmail} for similar work`,
      target: { developerName: corrections.developerName, developerEmail: corrections.developerEmail },
    });
  }
  if (note && memories.length === 0) {
    memories.push({
      memory_type: "team_note",
      pattern: note,
      target: { note },
    });
  }

  if (event.event_type === "approval" && memories.length === 0) return;
  if (memories.length === 0) return;

  await supabaseAdmin.from("learning_memories").insert(
    memories.map((memory) => ({
      ...base,
      ...memory,
    }))
  );
}
