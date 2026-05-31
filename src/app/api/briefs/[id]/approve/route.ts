import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { enqueueBriefDelivery } from "@/lib/jobs/queue";
import { setBriefStatus } from "@/lib/services/developer-brief";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await params;
    await setBriefStatus(id, "sending", { pm_action: "approve", pm_reviewed_at: new Date().toISOString() });
    await enqueueBriefDelivery({ briefId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "brief-approve" });
  }
}
