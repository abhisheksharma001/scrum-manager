import { describe, it, expect } from "vitest";
import { parseVTT } from "@/lib/providers/zoom";
import { N8nProvider } from "@/lib/providers/n8n";
import { GoogleMeetProvider } from "@/lib/providers/google-meet";
import fs from "fs";
import path from "path";

/**
 * Guard: every demo fixture in test/fixtures/ must parse cleanly through
 * the same parsers used by the live ingestion paths. See
 * docs/transcript-format.md for the format each fixture demonstrates.
 */
function fixture(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "test/fixtures", name),
    "utf-8"
  );
}

describe("demo fixtures parse through repo parsers", () => {
  it("sprint-planning.vtt parses via parseVTT (Zoom / Teams VTT)", () => {
    const utterances = parseVTT(fixture("sprint-planning.vtt"));

    expect(utterances).toHaveLength(12);
    expect(utterances[0]).toMatchObject({
      speaker: "Priya",
      startTime: 0.5,
      endTime: 4,
    });
    expect(new Set(utterances.map((u) => u.speaker))).toEqual(
      new Set(["Priya", "Marcus", "Dana", "Elena", "Sofia"])
    );
    // Last cue ends at 00:01:30.000
    expect(Math.max(...utterances.map((u) => u.endTime))).toBe(90);
  });

  it("weekly-sync.srt parses through the n8n SRT path", async () => {
    const provider = new N8nProvider();
    const parsed = provider.parseWebhook({
      fileContent: fixture("weekly-sync.srt"),
      fileName: "weekly-sync.srt",
      fileId: "fixture-srt",
    });
    expect(parsed).not.toBeNull();

    const result = await provider.fetchTranscript(
      parsed!.externalId,
      parsed!.metadata
    );

    expect(result.provider).toBe("n8n");
    expect(result.meetingTitle).toBe("weekly-sync");
    expect(result.utterances).toHaveLength(10);
    expect(result.utterances[0].speaker).toBe("Tom");
    // Millisecond commas parsed correctly; last cue ends at 00:01:25.000
    expect(result.duration).toBe(85);
    expect(result.attendees.map((a) => a.name).sort()).toEqual([
      "Chris",
      "Maya",
      "Tom",
    ]);
  });

  it("roadmap-review.gemini-notes.txt parses through the Google Meet Gemini Notes path", async () => {
    const provider = new GoogleMeetProvider();
    const parsed = provider.parseWebhook({
      transcript: fixture("roadmap-review.gemini-notes.txt"),
      filename:
        "Product Roadmap Review - 2026/04/14 10:02 CDT - Notes by Gemini",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata?.format).toBe("gemini-notes");

    const result = await provider.fetchTranscript(parsed!.externalId);

    expect(result.provider).toBe("google-meet");
    expect(result.meetingTitle).toBe("Product Roadmap Review");
    expect(result.utterances).toHaveLength(10);

    // "Invited email Name email Name ..." yields one email-backed entry per
    // address plus one display-name entry per person (parser semantics)
    expect(result.attendees).toEqual([
      { name: "dana.patel@ellavox.dev", email: "dana.patel@ellavox.dev" },
      { name: "Dana Patel" },
      { name: "marcus.webb@ellavox.dev", email: "marcus.webb@ellavox.dev" },
      { name: "Marcus Webb" },
      { name: "priya.sharma@ellavox.dev", email: "priya.sharma@ellavox.dev" },
      { name: "Priya Sharma" },
    ]);

    // Summary/Details context is preserved in metadata
    expect(String(result.metadata.summary)).toContain(
      "prioritize the mobile offline mode"
    );

    // Last timestamped utterance ends at 00:01:48
    expect(result.duration).toBe(108);
  });
});
