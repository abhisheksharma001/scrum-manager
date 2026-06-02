import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, ValidationError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase";
import { previewLearningRouting } from "@/lib/learning/routing";

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const taskId = new URL(request.url).searchParams.get("taskId");
    if (!taskId) throw new ValidationError("taskId is required");

    const { data: task, error } = await supabaseAdmin
      .from("extracted_tasks")
      .select("*, transcript:transcripts(*)")
      .eq("id", taskId)
      .single();
    if (error || !task) throw error ?? new Error("Task not found");

    const decision = await previewLearningRouting(task, { persist: false });
    return NextResponse.json({ decision });
  } catch (err) {
    return apiError(err, { route: "routing/preview" });
  }
}
