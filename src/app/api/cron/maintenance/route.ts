import { NextResponse } from "next/server";
import { processMaintenance } from "@/lib/jobs/processors";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Cron auth not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await processMaintenance({ type: "expire-claims" });
  await processMaintenance({ type: "expire-interviews" });

  return NextResponse.json({ ok: true });
}
