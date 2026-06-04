import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, ValidationError } from "@/lib/errors";
import { enqueueBriefDelivery } from "@/lib/jobs/queue";
import { setBriefStatus } from "@/lib/services/developer-brief";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await params;
    const { data: brief } = await supabaseAdmin
      .from("developer_briefs")
      .select("task_id, tracker_issue_key, task:extracted_tasks(approval_status, tracker_issue_key)")
      .eq("id", id)
      .maybeSingle();
    const task = Array.isArray(brief?.task) ? brief?.task[0] : brief?.task;
    if (task?.approval_status !== "approved") {
      throw new ValidationError("Brief delivery requires PM approval first");
    }
    await setBriefStatus(id, "sending", { pm_action: "manual_send", pm_reviewed_at: new Date().toISOString() });
    await enqueueBriefDelivery({ briefId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "brief-send" });
  }
}
