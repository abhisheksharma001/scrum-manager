import { NextRequest, NextResponse } from "next/server";
import { completeInterview } from "@/lib/services/interview-queue";
import { enqueueRepoAnalysis } from "@/lib/jobs/queue";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { interviewCompleteBody } from "@/lib/validation";
import { notifyInterviewCompleted } from "@/lib/services/notifications";
import { learningStore } from "@/lib/learning/store";
import { createBrief } from "@/lib/services/developer-brief";
import { shouldAnalyzeRepo } from "@/lib/services/task-readiness";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const user = await requireAuth(request);
    const { responses, assignee, developerName, developerEmail, projectKey, repoNames, workType, priority, labels } = await parseBody(
      interviewCompleteBody,
      await request.json()
    );

    const task = await completeInterview(taskId, user.id, {
      responses,
      assignee,
      developerName,
      developerEmail,
      projectKey,
      repoNames,
      workType,
      priority,
      labels,
    });

    await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId: task.id,
      eventType: "correction",
      scope: repoNames?.length || developerEmail || projectKey ? "teach_system" : "just_this_ticket",
      note: "PM completed interview review.",
      corrections: {
        assignee,
        developerName,
        developerEmail,
        projectKey,
        repoNames,
        priority,
        labels,
      },
      confidence: "medium",
    }).catch(() => null);

    if (shouldAnalyzeRepo(task)) {
      const brief = await createBrief(task.id, null);
      await enqueueRepoAnalysis({ briefId: brief.id });
    }

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
