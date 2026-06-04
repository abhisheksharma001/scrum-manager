import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { voiceCompleteBody } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const log = logger.child({ route: "voice-complete" });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    await rateLimit(`voice:${getClientIp(request)}`, { windowMs: 60_000, max: 10 });
    const user = await requireAuth(request);
    const { title, description, assignee, priority, labels, should_create, transcript } =
      await parseBody(voiceCompleteBody, await request.json());

    const responses: Record<string, string> = {};
    if (transcript) {
      for (let i = 0; i < transcript.length; i += 2) {
        const question = transcript[i]?.content || `Exchange ${i / 2 + 1}`;
        const answer = transcript[i + 1]?.content || "";
        responses[question] = answer;
      }
    }

    const validPriority = priority ?? "P2";

    if (!should_create) {
      await supabaseAdmin
        .from("extracted_tasks")
        .update({
          status: "dismissed",
          dismissed_reason: description,
          interview_responses: responses,
        })
        .eq("id", taskId);

      log.info({ taskId }, "Voice interview dismissed task");
      return NextResponse.json({ ok: true, action: "dismissed" });
    }

    await supabaseAdmin
      .from("extracted_tasks")
      .update({
        status: "awaiting_approval",
        approval_status: "awaiting_approval",
        extracted_title: title,
        extracted_description: description,
        inferred_assignees: assignee ? [{ name: assignee }] : undefined,
        priority: validPriority,
        labels,
        interview_responses: responses,
      })
      .eq("id", taskId);

    log.info({ taskId }, "Voice interview completed, task awaiting approval");
    return NextResponse.json({ ok: true, action: "awaiting_approval" });
  } catch (err) {
    return apiError(err, { route: "interviews/voice-complete", taskId });
  }
}
