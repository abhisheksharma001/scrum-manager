import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, ValidationError } from "@/lib/errors";
import { learningStore } from "@/lib/learning/store";
import type { Confidence, LearningCorrections, LearningFeedbackType, LearningScope } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();

    const eventType = body.eventType as LearningFeedbackType;
    if (!["correction", "approval", "rejection", "comment", "repo_override", "assignee_fix"].includes(eventType)) {
      throw new ValidationError("eventType is invalid");
    }

    const scope = (body.scope === "teach_system" ? "teach_system" : "just_this_ticket") as LearningScope;
    const event = await learningStore.recordFeedback({
      ownerUserId: user.id,
      taskId: typeof body.taskId === "string" ? body.taskId : null,
      briefId: typeof body.briefId === "string" ? body.briefId : null,
      eventType,
      scope,
      note: typeof body.note === "string" ? body.note : null,
      corrections: normalizeCorrections(body.corrections),
      confidence: normalizeConfidence(body.confidence),
    });

    return NextResponse.json({ feedback: event }, { status: 201 });
  } catch (err) {
    return apiError(err, { route: "learning/feedback" });
  }
}

function normalizeConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function normalizeCorrections(value: unknown): LearningCorrections {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const out: LearningCorrections = {};

  if (typeof raw.title === "string" && raw.title.trim()) out.title = raw.title.trim();
  if (typeof raw.description === "string" && raw.description.trim()) out.description = raw.description.trim();
  if (typeof raw.projectKey === "string" && raw.projectKey.trim()) out.projectKey = raw.projectKey.trim().toUpperCase();
  if (typeof raw.assignee === "string" && raw.assignee.trim()) out.assignee = raw.assignee.trim();
  if (raw.priority === "P0" || raw.priority === "P1" || raw.priority === "P2" || raw.priority === "P3") {
    out.priority = raw.priority;
  }
  if (Array.isArray(raw.labels)) out.labels = raw.labels.map(String).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw.repoNames)) out.repoNames = raw.repoNames.map(String).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw.paths)) out.paths = raw.paths.map(String).map((s) => s.trim()).filter(Boolean);

  return out;
}
