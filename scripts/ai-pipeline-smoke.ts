import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ProviderName = "claude" | "groq" | "kimi";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ExtractedTicket = {
  title: string;
  description: string;
  assignee: string | null;
  priority: "P0" | "P1" | "P2" | "P3";
  confidence: "high" | "medium" | "low";
  labels: string[];
  missingContext: string[];
  sourceQuotes: Array<{ speaker: string; timestamp: string; text: string }>;
};

type ExtractionResult = {
  tickets: ExtractedTicket[];
};

type JudgeResult = {
  pass: boolean;
  score: number;
  verdict: string;
  matchedIntent: string[];
  missedIntent: string[];
  extraOrWrongWork: string[];
  recommendedTicket: ExtractedTicket;
};

type SmokeProvider = {
  name: ProviderName;
  model: string;
  json<T>(messages: ChatMessage[], maxTokens: number): Promise<T>;
};

const repoPath = process.env.SHIRO_REPO_PATH ?? "/private/tmp/shiro-inspect";
const outputDir =
  process.env.AI_PIPELINE_OUTPUT_DIR ??
  process.env.GROQ_PIPELINE_OUTPUT_DIR ??
  path.join("/private/tmp", `tandem-ai-pipeline-${Date.now()}`);

const expectedProblem = {
  project: "abhisheksharma001/shiro",
  file: "Sources/Perception/STTService.swift",
  intent:
    "Meeting mode periodically flushes the full accumulated transcriptBuffer instead of only new segments, so every flush can reprocess old discussion and duplicate summaries or action items.",
  wantedTicket:
    "Prevent repeated meeting-mode transcript flushes by clearing or checkpointing transcriptBuffer after onMeetingFlush receives the current batch.",
  nonGoals: [
    "Do not replace Deepgram or LM Studio.",
    "Do not redesign MeetingModeView.",
    "Do not create a Jira issue in this smoke test.",
  ],
};

const transcript = String.raw`[00:00] Abhishek: morning folks, quick standup. before we do the very serious software pain, how was weekend?
[00:18] Maya: pretty chill. I went for dosa, got rained on, came home like a wet sock. solid 7 out of 10.
[00:36] Dev: mine was mostly sleeping and pretending I would clean my desk. spoiler, desk is still a crime scene.
[00:55] Riya: I had family over. good chaos. also my nephew kept asking if my laptop is where the robots live, which honestly, fair.
[01:14] Karan: weekend was fine. I tried Shiro meeting mode on a call though, so emotionally I am still in Monday already.
[01:32] Abhishek: oh nice, or not nice. before that, any blockers from Friday?
[01:50] Maya: Node bridge looked okay after the socket retry tweak. I did not see the old one-shot crash.
[02:08] Dev: MCP registry loads. some servers fail auth if placeholders are still there, but that's expected and at least the error is readable.
[02:26] Riya: UI side, meeting overlay opens, the pulsing REC dot works, transcript lines append. it looks kind of sick actually.
[02:44] Karan: yeah the UI is okay. the weird part is the summary/action stuff. I think it keeps eating the same transcript again.
[03:02] Abhishek: say that slowly. what exactly happened?
[03:19] Karan: I ran a ten-ish minute meeting. at two minutes it summarized the first chunk, fine. at four minutes the summary talked about the first chunk again plus the new stuff. at six, same nonsense, like it had memory but the annoying kind.
[03:42] Maya: that sounds like the flush callback is getting the whole buffer every time, not just the delta.
[04:00] Dev: I looked quickly at STTService. transcriptBuffer is an array on the service, segments append when Deepgram or Whisper finalizes text.
[04:20] Dev: then flushMeetingBuffer does let segments = transcriptBuffer, guard empty, onMeetingFlush?(segments). I did not see a clear after that.
[04:42] Riya: oof, so every timer tick sends all old lines again. no wonder action items are duplicated.
[05:01] Abhishek: is it only summary duplicate, or could it make tasks duplicate too later?
[05:18] Maya: both. right now MeetingModeView auto summary is the obvious symptom, but if we wire action item extraction to that flush, it will repeatedly extract the same action item every two minutes.
[05:42] Karan: this is exactly what I saw. it made a summary saying "we decided to check bridge logs" three times. we did decide that, but not in a spiritual loop.
[06:03] Riya: fix should be tiny. either clear transcriptBuffer after onMeetingFlush or track a lastFlushedIndex. clearing is easy but we need to not lose final transcript for End Meeting.
[06:26] Dev: yeah, careful. stopMeetingMode currently returns transcriptBuffer, and End Meeting saves lines from the view anyway. If we clear the service buffer, stopMeetingMode may return only unflushed remainder, but the UI lines already hold full transcript.
[06:52] Maya: I prefer lastFlushedIndex because it keeps transcriptBuffer complete and flush only sends suffix. less weird with stopMeetingMode.
[07:12] Abhishek: agreed. ticket should say checkpoint flushed meeting segments, not "wipe all transcript."
[07:30] Karan: acceptance criteria: two minute flush sends first batch, four minute flush sends only new lines, end meeting still has full transcript.
[07:52] Riya: add a small unit-ish test if possible. simulate three segments, flush, add two more, flush, assert callback got 3 then 2 not 5.
[08:14] Dev: also handle stop/start. when startMeetingMode resets transcriptBuffer, reset lastFlushedIndex too.
[08:34] Maya: if someone mutes/unmutes, startMeetingMode may run again. make sure the index doesn't point past the new buffer and silently drop speech.
[08:56] Abhishek: priority?
[09:03] Karan: P1 for meeting mode. alpha, yes, but duplicate action items makes the feature look dumb.
[09:20] Riya: assignee Dev? he already looked at STTService.
[09:30] Dev: yeah I can take it. should be just STTService plus test coverage if we have a test target. no Jira for now, just capture it properly.
[09:48] Abhishek: cool. raw ticket should be "Prevent duplicate meeting transcript flushes" or similar. not a Deepgram rewrite, not UI polish.
[10:00] Maya: exactly. please do not let the agent wander into audio formats. this is buffer bookkeeping, boring but important.`;

async function main() {
  await mkdir(outputDir, { recursive: true });
  const evidence = await loadEvidence();
  const provider = await chooseProvider();

  const transcriptPath = path.join(outputDir, "shiro-standup-transcript.txt");
  const reportPath = path.join(outputDir, "ai-pipeline-report.json");
  await writeFile(transcriptPath, transcript, "utf8");

  const extraction = await extractTicket(provider, transcript, evidence);
  const bestTicket = extraction.tickets[0];
  if (!bestTicket) {
    throw new Error(`${provider.name} returned no tickets from the transcript.`);
  }

  const deterministicPass = deterministicCheck(bestTicket);
  const judge = await judgeTicket(provider, bestTicket, evidence);
  const passed = deterministicPass && judge.pass && judge.score >= 0.8;

  const report = {
    passed,
    provider: provider.name,
    model: provider.model,
    outputDir,
    transcriptPath,
    selectedProblem: expectedProblem,
    evidence,
    pipeline: [
      "manual transcript received",
      "utterances normalized from raw standup text",
      `${provider.name} extracted ticket candidates`,
      "Jira creation skipped",
      `${provider.name} judged top ticket against expected Shiro issue`,
    ],
    extraction,
    judge,
    deterministicPass,
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`PASS=${passed}`);
  console.log(`PROVIDER=${provider.name}`);
  console.log(`MODEL=${provider.model}`);
  console.log(`TRANSCRIPT=${transcriptPath}`);
  console.log(`REPORT=${reportPath}`);
  console.log(`TICKET_TITLE=${bestTicket.title}`);
  console.log(`JUDGE_SCORE=${judge.score}`);
  console.log(`JUDGE_VERDICT=${judge.verdict}`);

  if (!passed) {
    process.exitCode = 1;
  }
}

async function loadEvidence() {
  const filePath = path.join(repoPath, expectedProblem.file);
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  const flushLine = lines.findIndex((line) =>
    line.includes("private func flushMeetingBuffer()")
  );
  const bufferLine = lines.findIndex((line) =>
    line.includes("private var transcriptBuffer")
  );
  const snippetStart = Math.max(0, flushLine - 2);
  const snippetEnd = Math.min(lines.length, flushLine + 7);

  return {
    repoPath,
    file: expectedProblem.file,
    transcriptBufferLine: bufferLine + 1,
    flushFunctionLine: flushLine + 1,
    snippet: lines
      .slice(snippetStart, snippetEnd)
      .map((line, index) => `${snippetStart + index + 1}: ${line}`)
      .join("\n"),
  };
}

async function chooseProvider(): Promise<SmokeProvider> {
  const requested = process.env.AI_SMOKE_PROVIDER?.toLowerCase() as ProviderName | undefined;
  const candidates: ProviderName[] = requested
    ? [requested]
    : ["claude", "groq", "kimi"];

  for (const name of candidates) {
    if (name === "claude" && process.env.ANTHROPIC_API_KEY) return claudeProvider();
    if (name === "groq" && process.env.GROQ_API_KEY) return groqProvider();
    if (name === "kimi" && (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY)) {
      return kimiProvider();
    }
  }

  throw new Error(
    "No AI smoke provider is configured. Set ANTHROPIC_API_KEY, GROQ_API_KEY, or KIMI_API_KEY. Optionally set AI_SMOKE_PROVIDER=claude|groq|kimi."
  );
}

function claudeProvider(): SmokeProvider {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  return {
    name: "claude",
    model,
    json: (messages, maxTokens) =>
      anthropicJson(apiKey, model, messages, maxTokens),
  };
}

function groqProvider(): SmokeProvider {
  const apiKey = requireEnv("GROQ_API_KEY");
  const model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  return {
    name: "groq",
    model,
    json: (messages, maxTokens) =>
      openAICompatibleJson({
        provider: "Groq",
        apiKey,
        baseUrl: "https://api.groq.com/openai/v1",
        model,
        messages,
        maxTokens,
      }),
  };
}

function kimiProvider(): SmokeProvider {
  const apiKey = process.env.KIMI_API_KEY ?? requireEnv("MOONSHOT_API_KEY");
  const model = process.env.KIMI_MODEL ?? "kimi-k2.6";
  return {
    name: "kimi",
    model,
    json: (messages, maxTokens) =>
      openAICompatibleJson({
        provider: "Kimi",
        apiKey,
        baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
        model,
        messages,
        maxTokens,
      }),
  };
}

async function extractTicket(
  provider: SmokeProvider,
  rawTranscript: string,
  evidence: unknown
) {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You extract engineering tickets from raw standup transcripts. Return only JSON with a tickets array. Be conservative and ignore weekend chatter.",
    },
    {
      role: "user",
      content: `Project evidence:\n${JSON.stringify(evidence, null, 2)}\n\nRaw standup transcript:\n${rawTranscript}\n\nReturn JSON in this shape:\n{"tickets":[{"title":"imperative concise title","description":"full context and why it matters","assignee":"name or null","priority":"P0|P1|P2|P3","confidence":"high|medium|low","labels":["..."],"missingContext":["..."],"sourceQuotes":[{"speaker":"name","timestamp":"mm:ss","text":"quote"}]}]}`,
    },
  ];

  return provider.json<ExtractionResult>(messages, 1800);
}

async function judgeTicket(
  provider: SmokeProvider,
  ticket: ExtractedTicket,
  evidence: unknown
) {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a strict QA judge for an AI ticket extraction pipeline. Return only JSON.",
    },
    {
      role: "user",
      content: `Expected issue:\n${JSON.stringify(expectedProblem, null, 2)}\n\nRepo evidence:\n${JSON.stringify(evidence, null, 2)}\n\nExtracted ticket:\n${JSON.stringify(ticket, null, 2)}\n\nJudge whether the extracted ticket captures the intended issue. Return JSON:\n{"pass":true,"score":0.0,"verdict":"short","matchedIntent":["..."],"missedIntent":["..."],"extraOrWrongWork":["..."],"recommendedTicket":{same ticket schema}}`,
    },
  ];

  return provider.json<JudgeResult>(messages, 1600);
}

async function anthropicJson<T>(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<T> {
  const system = messages.find((message) => message.role === "system")?.content;
  const userMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.1,
      system,
      messages: userMessages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = payload.content?.find((item) => item.type === "text")?.text;
  if (!content) throw new Error("Anthropic returned an empty response.");
  return parseJsonObject<T>(content, "Anthropic");
}

async function openAICompatibleJson<T>(input: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
}): Promise<T> {
  const body = {
    model: input.model,
    messages: input.messages,
    temperature: 0.1,
    max_tokens: input.maxTokens,
    response_format: { type: "json_object" },
  };

  let response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok && response.status === 400) {
    response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, response_format: undefined }),
    });
  }

  if (!response.ok) {
    throw new Error(`${input.provider} request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${input.provider} returned an empty response.`);
  return parseJsonObject<T>(content, input.provider);
}

function parseJsonObject<T>(content: string, provider: string): T {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error(`Could not parse JSON from ${provider} response: ${content}`);
  }
}

function deterministicCheck(ticket: ExtractedTicket): boolean {
  const haystack = `${ticket.title}\n${ticket.description}\n${ticket.labels.join(" ")}`.toLowerCase();
  const mentionsFlush = haystack.includes("flush");
  const mentionsTranscript = haystack.includes("transcript") || haystack.includes("segment");
  const mentionsDuplicate =
    haystack.includes("duplicate") ||
    haystack.includes("repeat") ||
    haystack.includes("reprocess") ||
    haystack.includes("old discussion");
  const avoidsWrongScope =
    !haystack.includes("deepgram rewrite") &&
    !haystack.includes("replace deepgram") &&
    !haystack.includes("ui redesign");

  return mentionsFlush && mentionsTranscript && mentionsDuplicate && avoidsWrongScope;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be provided in the environment.`);
  return value;
}

await main();
