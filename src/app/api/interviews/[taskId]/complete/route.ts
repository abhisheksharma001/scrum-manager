import { NextRequest, NextResponse } from "next/server";
import { completeInterview } from "@/lib/services/interview-queue";
import { enqueueJiraCreation } from "@/lib/jobs/queue";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { interviewCompleteBody } from "@/lib/validation";
import { notifyInterviewCompleted } from "@/lib/services/notifications";
import { learningStore } from "@/lib/learning/store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const user = await requireAuth(request);
    const { responses, assignee, priority, labels } = await parseBody(
      interviewCompleteBody,
      await request.json()
    );

    const task = await completeInterview(taskId, user.id, {
      responses,
      assignee,
      priority,
      labels,
    });

    await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId: task.id,
      eventType: "correction",
      scope: "just_this_ticket",
      note: "PM completed interview review.",
      corrections: { assignee, priority, labels },
      confidence: "medium",
    }).catch(() => null);

    await enqueueJiraCreation({ taskId: task.id });

    // Notify team that interview is complete
    await notifyInterviewCompleted(
      task.id,
      task.extracted_title,
      user.email
    );

    return NextResponse.json({ task });
  } catch (err) {
    return apiError(err, { route: "interviews/complete", taskId });
  }
}
