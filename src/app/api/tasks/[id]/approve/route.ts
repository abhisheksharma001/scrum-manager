import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, NotFoundError, ValidationError } from "@/lib/errors";
import { enqueueJiraCreation } from "@/lib/jobs/queue";
import { learningStore } from "@/lib/learning/store";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const user = await requireAuth(request);
    const { data: task } = await supabaseAdmin
      .from("extracted_tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!task) throw new NotFoundError("Task not found");
    if (task.status !== "awaiting_approval" && task.approval_status !== "awaiting_approval") {
      throw new ValidationError("Task is not ready for approval");
    }

    await supabaseAdmin
      .from("extracted_tasks")
      .update({
        status: "approved",
        approval_status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);

    await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId: id,
      eventType: "approval",
      scope: "just_this_ticket",
      note: "PM approved task for Jira creation.",
      confidence: "medium",
    }).catch(() => null);

    await enqueueJiraCreation({ taskId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "tasks/approve", taskId: id });
  }
}
