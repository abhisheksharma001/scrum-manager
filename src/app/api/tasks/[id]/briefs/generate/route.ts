import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase";
import { createBrief } from "@/lib/services/developer-brief";
import { enqueueRepoAnalysis } from "@/lib/jobs/queue";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await params;
    const { data: task, error } = await supabaseAdmin
      .from("extracted_tasks")
      .select("id, tracker_issue_key")
      .eq("id", id)
      .single();
    if (error || !task) throw new Error("Task not found");

    const brief = await createBrief(task.id, task.tracker_issue_key);
    await enqueueRepoAnalysis({ briefId: brief.id });
    return NextResponse.json({ ok: true, briefId: brief.id });
  } catch (err) {
    return apiError(err, { route: "task-brief-generate" });
  }
}
