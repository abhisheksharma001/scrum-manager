import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { setBriefStatus } from "@/lib/services/developer-brief";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    await setBriefStatus(id, "rejected", {
      pm_action: "reject",
      pm_reviewed_at: new Date().toISOString(),
      error_detail: body.reason || null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, { route: "brief-reject" });
  }
}
