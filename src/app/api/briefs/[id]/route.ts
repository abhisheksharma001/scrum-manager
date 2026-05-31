import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { getBrief } from "@/lib/services/developer-brief";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await params;
    const brief = await getBrief(id);
    return NextResponse.json({ brief });
  } catch (err) {
    return apiError(err, { route: "brief-by-id" });
  }
}
