import { NextRequest, NextResponse } from "next/server";
import { dismissTask } from "@/lib/services/interview-queue";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { interviewDismissBody } from "@/lib/validation";
import { learningStore } from "@/lib/learning/store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const user = await requireAuth(request);
    const { reason } = await parseBody(interviewDismissBody, await request.json());

    await dismissTask(taskId, user.id, reason);
    await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId,
      eventType: "rejection",
      scope: "just_this_ticket",
      note: reason || "PM dismissed this as not a real task.",
      confidence: "medium",
    }).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "interviews/dismiss", taskId });
  }
}
