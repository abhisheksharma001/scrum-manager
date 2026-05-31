import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { enqueueRepoAnalysis } from "@/lib/jobs/queue";
import { setBriefStatus } from "@/lib/services/developer-brief";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await params;
    await setBriefStatus(id, "queued", {
      pm_action: "regenerate",
      pm_reviewed_at: new Date().toISOString(),
      error_code: null,
      error_detail: null,
    });
    await enqueueRepoAnalysis({ briefId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "brief-regenerate" });
  }
}
