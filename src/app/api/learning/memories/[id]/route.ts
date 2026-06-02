import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { learningStore } from "@/lib/learning/store";
import type { LearningMemoryStatus } from "@/lib/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    const patch: Record<string, unknown> = {};
    if (["active", "pending", "inactive"].includes(body.status)) {
      patch.status = body.status as LearningMemoryStatus;
    }
    if (typeof body.pattern === "string" && body.pattern.trim()) {
      patch.pattern = body.pattern.trim();
    }
    if (body.target && typeof body.target === "object") {
      patch.target = body.target;
    }
    if (typeof body.confidence === "number") {
      patch.confidence = Math.max(0, Math.min(1, body.confidence));
    }

    const memory = await learningStore.updateMemory(user.id, id, patch);
    return NextResponse.json({ memory });
  } catch (err) {
    return apiError(err, { route: "learning/memories/[id]" });
  }
}
