import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { listBriefs } from "@/lib/services/developer-brief";

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const briefs = await listBriefs(status as never);
    return NextResponse.json({ briefs });
  } catch (err) {
    return apiError(err, { route: "briefs" });
  }
}
