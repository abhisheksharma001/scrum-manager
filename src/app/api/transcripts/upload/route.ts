import { NextRequest, NextResponse } from "next/server";
import { ManualProvider } from "@/lib/providers/manual";
import { ingestTranscript } from "@/lib/services/ingestion";
import { enqueueTranscriptProcessing } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { ValidationError } from "@/lib/errors";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const log = logger.child({ route: "transcripts/upload" });
const manualProvider = new ManualProvider();

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    await rateLimit(`upload:${getClientIp(request)}`, { windowMs: 60_000, max: 5 });

    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
      throw new ValidationError("File too large (max 10MB)");
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const meetingTitle = formData.get("meetingTitle") as string;
    const meetingDate = formData.get("meetingDate") as string;
    const attendeesRaw = formData.get("attendees") as string;

    if (!file || !meetingTitle || !meetingDate) {
      throw new ValidationError("file, meetingTitle, and meetingDate are required");
    }

    const fileName = file.name.toLowerCase();
    let format: "vtt" | "txt" | "srt";
    if (fileName.endsWith(".vtt")) format = "vtt";
    else if (fileName.endsWith(".srt")) format = "srt";
    else format = "txt";

    const fileContent = await file.text();

    let attendees: Array<{ name: string; email?: string }> = [];
    if (attendeesRaw) {
      try {
        attendees = JSON.parse(attendeesRaw);
      } catch {
        attendees = attendeesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name }));
      }
    }

    const transcript = manualProvider.parseUpload(fileContent, format, {
      meetingTitle,
      meetingDate: new Date(meetingDate),
      attendees,
    });

    const { id: transcriptId, isDuplicate } = await ingestTranscript(transcript, {
      ownerUserId: user.id,
    });

    if (isDuplicate) {
      return NextResponse.json(
        { ok: true, transcriptId, duplicate: true },
        { status: 200 }
      );
    }

    await enqueueTranscriptProcessing({
      transcriptId,
      provider: transcript.provider,
      externalId: transcript.externalId,
      meetingTitle: transcript.meetingTitle,
      meetingDate: transcript.meetingDate.toISOString(),
      attendees: transcript.attendees,
      duration: transcript.duration,
      utterances: transcript.utterances,
    });

    log.info({ transcriptId, meetingTitle }, "Manual transcript uploaded");

    return NextResponse.json({ ok: true, transcriptId }, { status: 201 });
  } catch (err) {
    return apiError(err, { route: "transcripts/upload" });
  }
}
