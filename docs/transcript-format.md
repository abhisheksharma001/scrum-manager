# Transcript Formats

Ellavox accepts meeting transcripts through several ingestion paths. This
document describes the formats each path expects, and points at the sample
fixtures in `test/fixtures/` you can use for demos and local testing.

## WebVTT (`.vtt`) — Zoom & MS Teams webhooks

Used by the Zoom (`recording.completed`) and MS Teams (Graph transcripts)
providers. Each cue has a timestamp line followed by one or more text lines.
A `Speaker: text` prefix on the first text line sets the speaker; without it
the speaker is recorded as `Unknown`.

```vtt
WEBVTT

00:00:01.000 --> 00:00:05.000
Sean: Alright, let's get started.

00:00:06.000 --> 00:00:10.000
Alex: I've got the handler working.
```

- Timestamps are `HH:MM:SS.mmm --> HH:MM:SS.mmm`.
- Cues must be separated by a blank line.
- Sample fixture: `test/fixtures/sprint-planning.vtt` (also `sample.vtt`).

## SubRip (`.srt`) — n8n uploads

The n8n provider accepts `.srt` files directly in the webhook payload.
Format is the classic numbered-cue layout with comma milliseconds:

```srt
1
00:00:01,000 --> 00:00:06,000
Tom: Weekly sync. Let's go around.
```

- Cue index line, then the timestamp line, then the text.
- Milliseconds use a **comma** (`,`), not a period.
- Sample fixture: `test/fixtures/weekly-sync.srt` (also `sample.srt`).

## Plain text (`.txt`) — n8n uploads / manual upload

One utterance per line, optionally speaker-attributed:

```text
Sean: Alright, let's get started.
Alex: I've got the handler working.
```

Lines without a `Speaker:` prefix still become utterances attributed to
`Unknown`. Timestamps are synthesized (5-second slots) when absent.
Sample fixtures: `test/fixtures/sample-transcript.txt`.

## Gemini Notes — Google Meet provider

The Google Meet provider accepts raw "Notes by Gemini" documents posted
directly to the webhook, or forwarded via n8n. The parser expects:

1. A filename/title line of the form
   `Title - YYYY/MM/DD HH:MM TZ - Notes by Gemini`
   (title and meeting date are extracted from this line).
2. An `Invited ...` line listing attendees (emails and names).
3. Optional `Summary` and `Details` sections kept as meeting context.
4. A `📖 Transcript` section containing:
   - timestamp lines in `HH:MM:SS` form, and
   - utterance lines as `Speaker Name: what they said`.

Utterances inherit the most recent timestamp; each ends where the next begins.

Sample fixture: `test/fixtures/roadmap-review.gemini-notes.txt`.

## Trying the fixtures locally

Post an n8n-style payload against the local webhook route:

```bash
curl -X POST http://localhost:3000/api/webhooks/n8n \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rs '{ fileContent: ., fileName: "weekly-sync.srt", meetingTitle: "Weekly Sync" }' test/fixtures/weekly-sync.srt)"
```

Zoom and MS Teams ingestion additionally require real provider credentials
(see `.env.example`); the fixtures cover the transcript formats those paths
download and parse.
