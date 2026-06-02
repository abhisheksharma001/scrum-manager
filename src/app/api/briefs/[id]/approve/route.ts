import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { enqueueBriefDelivery } from "@/lib/jobs/queue";
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
    await setBriefStatus(id, "sending", { pm_action: "approve", pm_reviewed_at: new Date().toISOString() });
    const { data: brief } = await supabaseAdmin
      .from("developer_briefs")
      .select("task_id")
      .eq("id", id)
      .maybeSingle();
    await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId: brief?.task_id ?? null,
      briefId: id,
      eventType: "approval",
      scope: "just_this_ticket",
      note: "PM approved developer brief.",
      confidence: "low",
    }).catch(() => null);
    await enqueueBriefDelivery({ briefId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "brief-approve" });
  }
}
