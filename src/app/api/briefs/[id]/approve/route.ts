import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, ValidationError } from "@/lib/errors";
import { enqueueJiraCreation } from "@/lib/jobs/queue";
import { setBriefStatus } from "@/lib/services/developer-brief";
import { learningStore } from "@/lib/learning/store";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const { data: brief } = await supabaseAdmin
      .from("developer_briefs")
      .select("id, task_id, status, brief, task:extracted_tasks(id, status, approval_status, assigned_developer_email, inferred_assignees, missing_context)")
      .eq("id", id)
      .maybeSingle();
    if (!brief?.task_id) throw new Error("Brief task not found");
    const task = Array.isArray(brief.task) ? brief.task[0] : brief.task;
    if (brief.status !== "awaiting_pm_review" || !brief.brief) {
      throw new ValidationError("Prompt pack must finish repo analysis before approval");
    }
    if (task?.approval_status !== "awaiting_approval" && task?.status !== "awaiting_approval") {
      throw new ValidationError("Task is not awaiting approval");
    }
    const inferredEmail = task?.inferred_assignees?.[0]?.email;
    if (!task?.assigned_developer_email && !inferredEmail) {
      const emailQuestion = "What is the assigned developer's email?";
      const existingMissing = Array.isArray(task?.missing_context) ? task.missing_context : [];
      await supabaseAdmin
        .from("extracted_tasks")
        .update({
          status: "pending_interview",
          approval_status: "not_ready",
          missing_context: existingMissing.includes(emailQuestion)
            ? existingMissing
            : [...existingMissing, emailQuestion],
        })
        .eq("id", brief.task_id);
      throw new ValidationError("Developer email is required before approving a prompt pack");
    }

    await supabaseAdmin
      .from("extracted_tasks")
      .update({
        status: "approved",
        approval_status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", brief.task_id);

    await setBriefStatus(id, "sending", {
      pm_action: "approve",
      pm_reviewer: user.id,
      pm_reviewed_at: new Date().toISOString(),
    });

    await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId: brief?.task_id ?? null,
      briefId: id,
      eventType: "approval",
      scope: "just_this_ticket",
      note: "PM approved developer brief.",
      confidence: "low",
    }).catch(() => null);
    await enqueueJiraCreation({ taskId: brief.task_id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "brief-approve" });
  }
}
