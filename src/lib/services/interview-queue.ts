import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { ExtractedTaskRow, InterviewSubmission } from "@/lib/types";
import { inferWorkType } from "./task-readiness";

const log = logger.child({ service: "interview-queue" });

/**
 * Get pending interviews, sorted by relevance to the requesting user.
 */
export async function getPendingInterviews(
  userEmail?: string
): Promise<ExtractedTaskRow[]> {
  const { data, error } = await supabaseAdmin
    .from("extracted_tasks")
    .select("*, transcript:transcripts(*)")
    .in("status", ["pending_interview", "claimed"])
    .order("created_at", { ascending: false });

  if (error) {
    log.error({ error }, "Failed to fetch pending interviews");
    throw error;
  }

  if (!data) return [];

  // Sort: user's meetings first, then by priority, then by recency
  return sortInterviews(data, userEmail);
}

function sortInterviews(
  tasks: ExtractedTaskRow[],
  userEmail?: string
): ExtractedTaskRow[] {
  const priorityOrder: Record<string, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3,
  };

  return tasks.sort((a, b) => {
    if (userEmail) {
      // 1. Suggested interviewer match (strongest signal)
      const aIsSuggested = isSuggestedInterviewer(a, userEmail);
      const bIsSuggested = isSuggestedInterviewer(b, userEmail);
      if (aIsSuggested && !bIsSuggested) return -1;
      if (!aIsSuggested && bIsSuggested) return 1;

      // 2. User's meetings
      const aIsUserMeeting = isUserMeeting(a, userEmail);
      const bIsUserMeeting = isUserMeeting(b, userEmail);
      if (aIsUserMeeting && !bIsUserMeeting) return -1;
      if (!aIsUserMeeting && bIsUserMeeting) return 1;
    }

    // 3. By priority
    const aPri = priorityOrder[a.priority] ?? 2;
    const bPri = priorityOrder[b.priority] ?? 2;
    if (aPri !== bPri) return aPri - bPri;

    // 4. By recency (newest first)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function isSuggestedInterviewer(task: ExtractedTaskRow, userEmail: string): boolean {
  const si = task.suggested_interviewer;
  if (!si?.email) return false;
  return si.email.toLowerCase() === userEmail.toLowerCase();
}

function isUserMeeting(task: ExtractedTaskRow, userEmail: string): boolean {
  const transcript = task.transcript;
  if (!transcript?.attendees) return false;
  return (transcript.attendees as Array<{ email?: string }>).some(
    (a) => a.email === userEmail
  );
}

/**
 * Claim an interview. Returns the updated task or throws if already claimed.
 */
export async function claimInterview(
  taskId: string,
  userId: string,
  timeoutMinutes: number = 30
): Promise<ExtractedTaskRow> {
  // Check current status
  const { data: task, error: fetchError } = await supabaseAdmin
    .from("extracted_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (fetchError || !task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.status === "claimed" && task.claimed_by !== userId) {
    // Check if the claim has expired
    if (task.claim_expires_at && new Date(task.claim_expires_at) > new Date()) {
      throw new Error("This interview is already claimed by another team member");
    }
    // Claim has expired, allow re-claim
  }

  if (!["pending_interview", "claimed"].includes(task.status)) {
    throw new Error(`Cannot claim task in status: ${task.status}`);
  }

  const claimExpiresAt = new Date(
    Date.now() + timeoutMinutes * 60 * 1000
  ).toISOString();

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("extracted_tasks")
    .update({
      status: "claimed",
      claimed_by: userId,
      claimed_at: new Date().toISOString(),
      claim_expires_at: claimExpiresAt,
    })
    .eq("id", taskId)
    .select("*")
    .single();

  if (updateError) {
    log.error({ error: updateError, taskId }, "Failed to claim interview");
    throw updateError;
  }

  log.info({ taskId, userId, claimExpiresAt }, "Interview claimed");
  return updated;
}

/**
 * Save partial interview responses (auto-save).
 */
export async function saveInterviewProgress(
  taskId: string,
  userId: string,
  responses: Record<string, string>
): Promise<void> {
  // Verify the user owns the claim
  const { data: task } = await supabaseAdmin
    .from("extracted_tasks")
    .select("claimed_by, status")
    .eq("id", taskId)
    .single();

  if (!task || task.claimed_by !== userId) {
    throw new Error("You do not have a claim on this interview");
  }

  if (task.status !== "claimed") {
    throw new Error(`Cannot save progress for task in status: ${task.status}`);
  }

  const { error } = await supabaseAdmin
    .from("extracted_tasks")
    .update({ interview_responses: responses })
    .eq("id", taskId);

  if (error) {
    log.error({ error, taskId }, "Failed to save interview progress");
    throw error;
  }

  log.info({ taskId }, "Interview progress saved");
}

/**
 * Complete an interview and route the task toward repo analysis or approval.
 * Jira creation remains approval-gated and is not triggered here.
 */
export async function completeInterview(
  taskId: string,
  userId: string,
  submission: InterviewSubmission
): Promise<ExtractedTaskRow> {
  const { data: task, error: fetchError } = await supabaseAdmin
    .from("extracted_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (fetchError || !task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.claimed_by !== userId) {
    throw new Error("You do not have a claim on this interview");
  }

  const resolvedWorkType = submission.workType ?? task.work_type ?? inferWorkType(
    submission.labels ?? task.labels ?? [],
    `${task.extracted_title} ${task.extracted_description} ${Object.values(submission.responses).join(" ")}`
  );
  const repoContextNeeded = resolvedWorkType === "code" || Boolean(submission.repoNames?.length);
  const nextStatus = repoContextNeeded ? "pending_repo_analysis" : "awaiting_approval";
  const approvalStatus = nextStatus === "awaiting_approval" ? "awaiting_approval" : "not_ready";
  const developerName = submission.developerName || submission.assignee;
  const developerEmail = submission.developerEmail;

  const updates: Record<string, unknown> = {
    status: nextStatus,
    approval_status: approvalStatus,
    interview_responses: submission.responses,
    work_type: resolvedWorkType,
    repo_context_needed: repoContextNeeded,
    assigned_developer_name: developerName ?? null,
    assigned_developer_email: developerEmail ?? null,
    claimed_by: null,
    claimed_at: null,
    claim_expires_at: null,
  };

  if (submission.assignee) {
    updates.inferred_assignees = [{ name: submission.assignee, email: developerEmail }];
  }
  if (submission.projectKey) updates.tracker_project = submission.projectKey.toUpperCase();
  if (submission.priority) {
    updates.priority = submission.priority;
  }
  if (submission.labels) {
    updates.labels = submission.labels;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("extracted_tasks")
    .update(updates)
    .eq("id", taskId)
    .select("*")
    .single();

  if (updateError) {
    log.error({ error: updateError, taskId }, "Failed to complete interview");
    throw updateError;
  }

  log.info({ taskId, userId }, "Interview completed");
  return updated;
}

/**
 * Dismiss a task as "not a real task".
 */
export async function dismissTask(
  taskId: string,
  userId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("extracted_tasks")
    .update({
      status: "dismissed",
      dismissed_reason: reason || null,
      claimed_by: userId,
    })
    .eq("id", taskId);

  if (error) {
    log.error({ error, taskId }, "Failed to dismiss task");
    throw error;
  }

  log.info({ taskId, userId, reason }, "Task dismissed");
}

/**
 * Release a claim early (unclaim).
 */
export async function releaseClaim(
  taskId: string,
  userId: string
): Promise<void> {
  const { data: task } = await supabaseAdmin
    .from("extracted_tasks")
    .select("claimed_by")
    .eq("id", taskId)
    .single();

  if (!task || task.claimed_by !== userId) {
    throw new Error("You do not have a claim on this interview");
  }

  await supabaseAdmin
    .from("extracted_tasks")
    .update({
      status: "pending_interview",
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
    })
    .eq("id", taskId);

  log.info({ taskId, userId }, "Claim released");
}

/**
 * Expire stale claims (run periodically via cron).
 */
export async function expireStaleClaims(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("extracted_tasks")
    .update({
      status: "pending_interview",
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
    })
    .eq("status", "claimed")
    .lt("claim_expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    log.error({ error }, "Failed to expire stale claims");
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    log.info({ count }, "Expired stale claims");
  }
  return count;
}

/**
 * Expire old unclaimed interviews (run periodically via cron).
 */
export async function expireOldInterviews(
  expiryHours: number = 72
): Promise<number> {
  const cutoff = new Date(
    Date.now() - expiryHours * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from("extracted_tasks")
    .update({ status: "expired" })
    .eq("status", "pending_interview")
    .lt("created_at", cutoff)
    .select("id");

  if (error) {
    log.error({ error }, "Failed to expire old interviews");
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    log.info({ count, expiryHours }, "Expired old interviews");
  }
  return count;
}
