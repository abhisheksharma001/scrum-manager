import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { learningStore } from "@/lib/learning/store";
import type { LearningMemoryStatus } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const statusParam = new URL(request.url).searchParams.get("status");
    const status = ["active", "pending", "inactive"].includes(statusParam ?? "")
      ? statusParam as LearningMemoryStatus
      : undefined;
    const memories = await learningStore.listMemories(user.id, status);
    return NextResponse.json({ memories });
  } catch (err) {
    return apiError(err, { route: "learning/memories" });
  }
}
