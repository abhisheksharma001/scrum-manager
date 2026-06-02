import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
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
    const body = await request.json().catch(() => ({}));
    await setBriefStatus(id, "rejected", {
      pm_action: "reject",
      pm_reviewed_at: new Date().toISOString(),
      error_detail: body.reason || null,
    });
    const { data: brief } = await supabaseAdmin
      .from("developer_briefs")
      .select("task_id")
      .eq("id", id)
      .maybeSingle();
    await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId: brief?.task_id ?? null,
      briefId: id,
      eventType: "rejection",
      scope: body.teachSystem ? "teach_system" : "just_this_ticket",
      note: body.reason || "PM rejected developer brief.",
      corrections: body.corrections,
      confidence: body.teachSystem ? "high" : "medium",
    }).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "brief-reject" });
  }
}
