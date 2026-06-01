import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  db,
  fetchCalls,
  generateTextMock,
  queuedJobs,
  resetState,
  sendQueueMessageMock,
  supabaseAdminMock,
} = vi.hoisted(() => {
  type Row = Record<string, any>;
  type TableName =
    | "transcripts"
    | "extracted_tasks"
    | "pipeline_config"
    | "developer_briefs"
    | "project_repos"
    | "brief_status_history";

  const db: Record<TableName, Row[]> = {
    transcripts: [],
    extracted_tasks: [],
    pipeline_config: [],
    developer_briefs: [],
    project_repos: [],
    brief_status_history: [],
  };

  const queuedJobs: Array<{ topic: string; data: any }> = [];
  const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
  const counters = {
    transcript: 1,
    task: 1,
    brief: 1,
    history: 1,
  };

  function isoNow() {
    return new Date("2026-06-01T09:30:00.000Z").toISOString();
  }

  function resetState() {
    for (const rows of Object.values(db)) rows.splice(0, rows.length);
    queuedJobs.splice(0, queuedJobs.length);
    fetchCalls.splice(0, fetchCalls.length);
    counters.transcript = 1;
    counters.task = 1;
    counters.brief = 1;
    counters.history = 1;

    db.pipeline_config.push(
      {
        id: "cfg-confidence",
        key: "confidence_auto_create_threshold",
        value: ["high"],
      },
      {
        id: "cfg-routes",
        key: "project_routes",
        value: [
          {
            projectKey: "ENG",
            name: "Engineering",
            routingPrompt: "Core Shiro product and delivery pipeline work.",
            isDefault: true,
          },
        ],
      },
      {
        id: "cfg-approval",
        key: "brief_approval_mode",
        value: "auto",
      },
      {
        id: "cfg-auto-send",
        key: "auto_send_min_confidence",
        value: "high",
      },
      {
        id: "cfg-budget",
        key: "brief_budget",
        value: {
          maxQueries: 2,
          maxFiles: 2,
          maxBytesPerFile: 8000,
          maxTotalBytes: 16000,
          maxToolCalls: 8,
        },
      }
    );

    db.project_repos.push({
      id: "repo-1",
      project_key: "ENG",
      repo_full_name: "abhisheksharma001/scrum-manager",
      is_primary: true,
      paths_hint: null,
      created_at: isoNow(),
    });
  }

  function tableRows(table: string): Row[] {
    return db[table as TableName] ?? [];
  }

  function rowMatches(row: Row, filters: Array<{ column: string; value: any }>, inFilters: Array<{ column: string; values: any[] }>) {
    return (
      filters.every((filter) => row[filter.column] === filter.value) &&
      inFilters.every((filter) => filter.values.includes(row[filter.column]))
    );
  }

  function withDefaults(table: string, payload: Row): Row {
    const base = { ...payload };
    if (!base.id) {
      if (table === "transcripts") base.id = `transcript-${counters.transcript++}`;
      if (table === "extracted_tasks") base.id = `task-${counters.task++}`;
      if (table === "developer_briefs") base.id = `brief-${counters.brief++}`;
      if (table === "brief_status_history") base.id = `history-${counters.history++}`;
    }
    if (!base.created_at) base.created_at = isoNow();
    if (!base.updated_at) base.updated_at = isoNow();

    if (table === "transcripts") {
      return {
        error_message: null,
        processed_at: null,
        ...base,
      };
    }

    if (table === "extracted_tasks") {
      return {
        claimed_by: null,
        claimed_at: null,
        claim_expires_at: null,
        dismissed_reason: null,
        interview_responses: null,
        tracker_project: null,
        tracker_issue_key: null,
        tracker_error: null,
        ...base,
      };
    }

    if (table === "developer_briefs") {
      return {
        repos: [],
        analyzed_commit_sha: null,
        candidate_files: [],
        brief: null,
        confidence: null,
        missing_info: [],
        model: null,
        token_usage: null,
        tool_calls: 0,
        bytes_read: 0,
        attempt: 0,
        pm_reviewer: null,
        pm_reviewed_at: null,
        pm_action: null,
        delivery: {},
        error_code: null,
        error_detail: null,
        ...base,
      };
    }

    return base;
  }

  function projectRow(row: Row, selection: string): Row {
    if (selection.includes("*")) {
      const copy = { ...row };
      if (selection.includes("transcript:transcripts(*)") && row.transcript_id) {
        copy.transcript = db.transcripts.find((transcript) => transcript.id === row.transcript_id) ?? null;
      }
      return copy;
    }

    const columns = selection
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return columns.reduce<Row>((out, column) => {
      out[column] = row[column];
      return out;
    }, {});
  }

  class QueryBuilder {
    private filters: Array<{ column: string; value: any }> = [];
    private inFilters: Array<{ column: string; values: any[] }> = [];
    private limitCount: number | null = null;
    private operation: "select" | "insert" | "update" | "upsert" = "select";
    private payload: any;
    private selection = "*";

    constructor(private table: string) {}

    select(selection = "*") {
      this.selection = selection;
      return this;
    }

    insert(payload: any) {
      this.operation = "insert";
      this.payload = payload;
      return this;
    }

    upsert(payload: any) {
      this.operation = "upsert";
      this.payload = payload;
      return this;
    }

    update(payload: any) {
      this.operation = "update";
      this.payload = payload;
      return this;
    }

    eq(column: string, value: any) {
      this.filters.push({ column, value });
      return this;
    }

    in(column: string, values: any[]) {
      this.inFilters.push({ column, values });
      return this;
    }

    order() {
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    async single() {
      const result = await this.execute();
      const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
      return { data, error: null };
    }

    async maybeSingle() {
      return this.single();
    }

    then<TResult1 = any, TResult2 = never>(
      onfulfilled?: ((value: { data: any; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.execute().then(onfulfilled, onrejected);
    }

    private async execute() {
      const rows = tableRows(this.table);
      let resultRows: Row[];

      if (this.operation === "insert") {
        const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
        resultRows = payloads.map((payload) => withDefaults(this.table, payload));
        rows.push(...resultRows);
      } else if (this.operation === "upsert") {
        const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
        resultRows = payloads.map((payload) => {
          const existing =
            this.table === "developer_briefs" && payload.task_id
              ? rows.find((row) => row.task_id === payload.task_id)
              : null;

          if (existing) {
            Object.assign(existing, payload, { updated_at: isoNow() });
            return existing;
          }

          const row = withDefaults(this.table, payload);
          rows.push(row);
          return row;
        });
      } else if (this.operation === "update") {
        resultRows = rows.filter((row) => rowMatches(row, this.filters, this.inFilters));
        for (const row of resultRows) {
          Object.assign(row, this.payload, { updated_at: isoNow() });
        }
      } else {
        resultRows = rows.filter((row) => rowMatches(row, this.filters, this.inFilters));
      }

      if (this.limitCount !== null) resultRows = resultRows.slice(0, this.limitCount);

      return {
        data: resultRows.map((row) => projectRow(row, this.selection)),
        error: null,
      };
    }
  }

  const supabaseAdminMock = {
    from: vi.fn((table: string) => new QueryBuilder(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };

  const sendQueueMessageMock = vi.fn(async (topic: string, data: any) => {
    queuedJobs.push({ topic, data });
    return { messageId: `msg-${queuedJobs.length}` };
  });

  const generateTextMock = vi.fn(async ({ system }: { system: string }) => {
    if (system.includes("meeting action item extractor")) {
      return {
        output: {
          tasks: [
            {
              title: "Fix Shiro transcript queue region config",
              description:
                "Alex committed to fix the queue callback region issue that makes Shiro transcript processing fail in production.",
              inferredAssignees: [{ name: "Alex", email: "alex@example.com" }],
              confidence: "high",
              missingContext: [],
              sourceQuotes: [
                {
                  speaker: "Alex",
                  text: "Queue callback works local but prod keeps yelling about region; I can patch it by EOD.",
                  timestamp: 5,
                },
              ],
              priority: "P1",
              labels: ["backend", "queue", "shiro"],
              suggestedInterviewer: { name: "Alex", email: "alex@example.com" },
            },
            {
              title: "Clarify Google Meet transcript API ownership",
              description:
                "The team said the Google Meet transcript fetch path is not fully owned and still needs a decision.",
              inferredAssignees: [],
              confidence: "medium",
              missingContext: ["Who owns Google Meet OAuth and transcript fetching?"],
              sourceQuotes: [
                {
                  speaker: "Priya",
                  text: "The Google Meet thing is half-wired; I do not know who owns OAuth.",
                  timestamp: 20,
                },
              ],
              priority: "P2",
              labels: ["google-meet", "integration"],
              suggestedInterviewer: { name: "Priya", email: "priya@example.com" },
            },
          ],
        },
      };
    }

    if (system.includes("senior technical product manager")) {
      return {
        output: {
          title: "Fix Shiro transcript queue region config",
          issueType: "Task",
          description:
            "Production queue callbacks for Shiro transcript processing should use an explicit supported region so processing does not fail outside local dev.",
          acceptanceCriteria: [
            "Given a queued transcript job, when the queue client is initialized, then it uses the configured region.",
            "Given no region is configured, when the app boots, then it uses the documented fallback region.",
            "Given the pipeline smoke test runs, then transcript processing reaches Jira creation.",
          ],
          technicalNotes: "Keep the change in the queue client wiring and avoid touching unrelated worker logic.",
          storyPoints: "2",
          priority: "P1",
          labels: ["backend", "queue", "shiro"],
          assignee: { name: "Alex", email: "alex@example.com" },
          blockedBy: [],
        },
      };
    }

    if (system.includes("targeted code-search queries")) {
      return {
        output: {
          queries: ["queue callback region", "transcript-processing queue"],
          target_paths: ["src/lib/jobs/queue-client.ts"],
          rationale: "The task points at queue callback configuration.",
        },
      };
    }

    if (system.includes("senior engineer preparing a concise developer brief")) {
      return {
        output: {
          task_name: "Fix Shiro transcript queue region config",
          assignee: "Alex",
          tracker_key: "ENG-101",
          tracker_url: "https://jira.example.test/browse/ENG-101",
          repos: ["abhisheksharma001/scrum-manager"],
          files_likely_involved: [
            {
              path: "src/lib/jobs/queue-client.ts",
              reason: "Queue client region is initialized here.",
            },
          ],
          existing_code_summary: "The project wraps Vercel Queue access behind a queue client module.",
          task_restated:
            "Make queue callbacks use the intended region so transcript processing behaves the same in production and local smoke tests.",
          suggested_approach: [
            "Read the queue client wrapper and confirm the region fallback.",
            "Keep the worker routes using the shared queue callback helper.",
          ],
          key_considerations: ["Avoid duplicating QueueClient construction in each route."],
          risks: ["A missing region can make callbacks fail only after deployment."],
          estimated_complexity: {
            level: "small",
            rationale: "The change is centralized and easy to verify with smoke coverage.",
          },
          dependencies: [],
          suggested_tests: ["pnpm test:pipeline", "pnpm build"],
          execution_pack: {
            plain_language_logic: [
              "Centralize the queue client setup.",
              "Use a safe default region when the deployment does not provide one.",
            ],
            technical_logic: [
              {
                area: "Queue client",
                change: "Initialize QueueClient once with a known region.",
              },
            ],
            implementation_steps: [
              "Inspect src/lib/jobs/queue-client.ts.",
              "Confirm queue routes consume the shared callback helper.",
            ],
            code_guidance: [
              {
                file: "src/lib/jobs/queue-client.ts",
                guidance: "Keep QueueClient construction in this module.",
              },
            ],
            tests_to_run: ["pnpm test:pipeline", "pnpm build"],
            agent_prompt:
              "You are working in the scrum-manager repository. Goal: make Shiro transcript queue callbacks consistently use the intended Vercel Queue region. Read src/lib/jobs/queue-client.ts and the queue route handlers first. Keep the QueueClient construction centralized, preserve the existing shared callback helper, avoid unrelated refactors, and run pnpm test:pipeline plus pnpm build before finishing.",
          },
          sample_snippets: [],
          confidence: "high",
          missing_info: [],
        },
      };
    }

    throw new Error(`Unhandled generateText call in pipeline smoke test: ${system}`);
  });

  resetState();

  return {
    db,
    fetchCalls,
    generateTextMock,
    queuedJobs,
    resetState,
    sendQueueMessageMock,
    supabaseAdminMock,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: supabaseAdminMock,
}));

vi.mock("@/lib/jobs/queue-client", () => ({
  handleQueueCallback: vi.fn(),
  sendQueueMessage: sendQueueMessageMock,
}));

vi.mock("@/lib/logger", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return { createChildLogger: vi.fn(() => logger), logger };
});

vi.mock("@/lib/services/notifications", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
  notifyAutoCreatedTasks: vi.fn().mockResolvedValue(undefined),
  notifyNewInterviews: vi.fn().mockResolvedValue(undefined),
  notifyPushFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("ai", () => ({
  Output: { object: vi.fn((value) => value) },
  generateText: generateTextMock,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn((model: string) => model),
}));

function fakeJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function fakeText(text: string, status = 200) {
  return new Response(text, { status });
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      fetchCalls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url.includes("/rest/api/3/user/search")) {
        return fakeJson([{ accountId: "account-alex" }]);
      }
      if (url.endsWith("/rest/api/3/project/ENG")) {
        return fakeJson({ issueTypes: [{ name: "Task" }, { name: "Bug" }] });
      }
      if (url.endsWith("/rest/api/3/issue") && method === "POST") {
        return fakeJson({ key: "ENG-101", self: "https://jira.example.test/rest/api/3/issue/ENG-101" }, 201);
      }
      if (url.includes("/rest/api/3/issue/ENG-101/watchers")) {
        return fakeText("", 204);
      }
      if (url.endsWith("/rest/api/3/issue/ENG-101/comment")) {
        return fakeJson({ id: "comment-1" }, 201);
      }
      if (url.startsWith("https://api.github.com/search/code")) {
        return fakeJson({
          items: [
            {
              path: "src/lib/jobs/queue-client.ts",
              score: 9.7,
            },
          ],
        });
      }
      if (url === "https://api.github.com/repos/abhisheksharma001/scrum-manager") {
        return fakeJson({ default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/abhisheksharma001/scrum-manager/branches/main") {
        return fakeJson({ commit: { sha: "abc123smoke" } });
      }
      if (url.includes("/contents/README.md")) {
        return fakeJson({
          content: Buffer.from("# Scrum Manager\n\nPipeline repo.").toString("base64"),
          encoding: "base64",
        });
      }
      if (url.includes("/contents/src/lib/jobs/queue-client.ts")) {
        return fakeJson({
          content: Buffer.from("export const queueRegion = process.env.VERCEL_REGION || 'iad1';").toString("base64"),
          encoding: "base64",
        });
      }
      if (url === "https://api.resend.com/emails") {
        return fakeJson({ id: "email-1" }, 202);
      }
      if (url === "https://hooks.slack.example.test/services/T000/B000/XXX") {
        return fakeText("ok");
      }

      return fakeText(`Unhandled fetch in pipeline smoke test: ${url}`, 500);
    })
  );
}

async function drainPipelineQueue() {
  const { TOPIC_NAMES } = await import("@/lib/jobs/queue");
  const {
    processBriefDelivery,
    processJiraCreation,
    processRepoAnalysis,
    processTranscript,
  } = await import("@/lib/jobs/processors");

  while (queuedJobs.length > 0) {
    const job = queuedJobs.shift()!;
    switch (job.topic) {
      case TOPIC_NAMES.TRANSCRIPT_PROCESSING:
        await processTranscript(job.data);
        break;
      case TOPIC_NAMES.JIRA_CREATION:
        await processJiraCreation(job.data);
        break;
      case TOPIC_NAMES.REPO_ANALYSIS:
        await processRepoAnalysis(job.data);
        break;
      case TOPIC_NAMES.BRIEF_DELIVERY:
        await processBriefDelivery(job.data);
        break;
      default:
        throw new Error(`Unexpected queued topic: ${job.topic}`);
    }
  }
}

describe("pipeline smoke", () => {
  beforeEach(() => {
    resetState();
    sendQueueMessageMock.mockClear();
    generateTextMock.mockClear();
    supabaseAdminMock.from.mockClear();
    installFetchMock();

    process.env.JIRA_BASE_URL = "https://jira.example.test";
    process.env.JIRA_EMAIL = "pm@example.com";
    process.env.JIRA_API_TOKEN = "jira-token";
    process.env.JIRA_DEFAULT_PROJECT = "ENG";
    process.env.GITHUB_READONLY_TOKEN = "github-token";
    process.env.RESEND_API_KEY = "resend-token";
    process.env.EMAIL_FROM = "Ellavox <noreply@example.test>";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.example.test/services/T000/B000/XXX";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  it("moves a noisy Shiro standup transcript through upload, extraction, Jira, repo brief, and delivery", async () => {
    const { POST } = await import("@/app/api/transcripts/upload/route");
    const { TOPIC_NAMES } = await import("@/lib/jobs/queue");

    const transcript = [
      "Sam: ok standup, shiro is kinda busted in prod, not in local, classic.",
      "Alex: Queue callback works local but prod keeps yelling about region; I can patch it by EOD if Sam confirms ENG.",
      "Sam: yeah ENG is fine, keep it tiny, no grand rewrite.",
      "Priya: The Google Meet thing is half-wired; I do not know who owns OAuth, somebody needs to call it.",
      "Alex: Cool, I will fix the region thing first and leave the meet thing for clarification.",
    ].join("\n");

    const form = new FormData();
    form.set("file", new File([transcript], "shiro-standup.txt", { type: "text/plain" }));
    form.set("meetingTitle", "Shiro standup");
    form.set("meetingDate", "2026-06-01T09:00:00.000Z");
    form.set(
      "attendees",
      JSON.stringify([
        { name: "Sam", email: "sam@example.com" },
        { name: "Alex", email: "alex@example.com" },
        { name: "Priya", email: "priya@example.com" },
      ])
    );

    const response = await POST(
      new NextRequest("http://localhost/api/transcripts/upload", {
        method: "POST",
        body: form,
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.transcriptId).toBe("transcript-1");
    expect(queuedJobs[0]).toMatchObject({
      topic: TOPIC_NAMES.TRANSCRIPT_PROCESSING,
      data: { transcriptId: "transcript-1", meetingTitle: "Shiro standup" },
    });

    await drainPipelineQueue();

    expect(queuedJobs).toHaveLength(0);
    expect(db.transcripts[0]).toMatchObject({
      id: "transcript-1",
      status: "completed",
      meeting_title: "Shiro standup",
      utterance_count: 5,
    });

    expect(db.extracted_tasks).toHaveLength(2);
    const autoCreatedTask = db.extracted_tasks.find((task) => task.status === "auto_created");
    const interviewTask = db.extracted_tasks.find((task) => task.status === "pending_interview");

    expect(autoCreatedTask).toMatchObject({
      extracted_title: "Fix Shiro transcript queue region config",
      tracker_project: "ENG",
      tracker_issue_key: "ENG-101",
    });
    expect(interviewTask).toMatchObject({
      extracted_title: "Clarify Google Meet transcript API ownership",
      missing_context: ["Who owns Google Meet OAuth and transcript fetching?"],
    });

    expect(db.developer_briefs).toHaveLength(1);
    expect(db.developer_briefs[0]).toMatchObject({
      task_id: autoCreatedTask!.id,
      tracker_issue_key: "ENG-101",
      status: "sent",
      confidence: "high",
      error_code: null,
      error_detail: null,
    });
    expect(db.developer_briefs[0].brief.execution_pack.agent_prompt).toContain("Shiro transcript queue callbacks");

    expect(fetchCalls.some((call) => call.url.endsWith("/rest/api/3/issue") && call.method === "POST")).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes("api.github.com/search/code"))).toBe(true);
    expect(fetchCalls.some((call) => call.url === "https://api.resend.com/emails")).toBe(true);
    expect(fetchCalls.some((call) => call.url === "https://hooks.slack.example.test/services/T000/B000/XXX")).toBe(true);
  });
});
