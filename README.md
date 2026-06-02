# Ellavox

Ellavox turns messy meeting transcripts into structured work. The current app can ingest a transcript, extract action items with AI, decide whether each task is ready for Jira or needs more human context, collect that context through an interview flow, create Jira issues, and prepare a developer execution pack that can be emailed, posted to Jira, and sent to Slack.

The project is not just a pitch page. The repo contains the working Next.js app, Supabase schema, queue processors, API routes, mocked end-to-end smoke coverage, and a provider-flexible AI smoke script for testing ticket extraction against a deliberately noisy standup transcript.

## What Works Today

### Transcript intake

Ellavox accepts transcripts through:

| Source | Current path |
|---|---|
| Manual upload | `POST /api/transcripts/upload` |
| Provider webhook | `POST /api/webhooks/[provider]` |
| n8n Google Drive flow | `POST /api/webhooks/n8n` |
| Stored transcript listing | `GET /api/transcripts` |

Incoming transcripts are normalized into utterances, stored in Supabase, deduplicated by `(provider, external_id)`, and queued for processing.

### AI extraction

The normal app pipeline uses Claude through the Vercel AI SDK. The extraction agent reads the meeting title, date, attendees, transcript text, and optional existing Jira context, then returns structured tasks with:

| Field | Purpose |
|---|---|
| Title | Concise imperative task name |
| Description | Meeting context, scope, and why the work matters |
| Assignees | Inferred owners, including emails when attendees provide them |
| Confidence | `high`, `medium`, or `low` |
| Missing context | Precise questions to ask a human when the task is unclear |
| Source quotes | Timestamped transcript evidence |
| Priority | `P0` through `P3` |
| Labels | Normalized routing/category hints |
| Suggested interviewer | Best person to answer follow-up questions |

The extractor is intentionally conservative. Casual chatter, repeated discussion, and ongoing work without a new action should be skipped.

### Confidence routing

Extracted tasks are routed by confidence:

| Confidence | Default behavior |
|---|---|
| `high` | Stored as `auto_created` and queued for Jira creation |
| `medium` / `low` | Stored as `pending_interview` and shown in the interview queue |

The auto-create threshold is configurable in the `pipeline_config` table. By default, only high-confidence tasks go straight to Jira.

### Human interview flow

When a task is missing context, Ellavox supports an interview workflow:

| Action | Route |
|---|---|
| List pending interviews | `GET /api/interviews` |
| Claim an interview | `POST /api/interviews/[taskId]/claim` |
| Save partial answers | `POST /api/interviews/[taskId]/save` |
| Complete text interview | `POST /api/interviews/[taskId]/complete` |
| Complete AI chat interview | `POST /api/interviews/[taskId]/ai-interview` |
| Complete voice interview | `POST /api/interviews/[taskId]/voice-complete` |
| Release a claim | `POST /api/interviews/[taskId]/release` |
| Dismiss false positives | `POST /api/interviews/[taskId]/dismiss` |

Completed interviews enrich the extracted task and enqueue Jira creation. Stale claims and old interviews are cleaned up by the maintenance cron route.

### Jira creation

Before pushing to Jira, the requirements agent turns the raw extracted task into a Jira-ready issue:

| Output | Description |
|---|---|
| Issue type | Story, Task, Bug, or Spike |
| Description | Full context, scope, and transcript/interview evidence |
| Acceptance criteria | 3-7 testable criteria |
| Technical notes | Architecture notes, affected systems, or gotchas |
| Story points | Fibonacci estimate |
| Priority and labels | Refined values from the raw extraction |
| Blockers | Explicit or implied dependencies |

Jira integration currently supports issue creation, project routing, assignee lookup, watcher additions, retry after failure, and manual push for eligible tasks.

### Developer execution packs

After Jira creation, Ellavox can create a developer brief for the task. This part is aimed at handing the work to a human developer or coding agent.

The repo brief flow can:

| Step | Current capability |
|---|---|
| Create brief shell | Linked to the extracted task and tracker key |
| Read repository context | Direct GitHub token or Composio GitHub proxy |
| Pick candidate files | Search and inspect likely implementation files |
| Generate execution pack | Claude writes plain-language logic, technical logic, tests, constraints, and a copy-paste agent prompt |
| Review gate | Briefs can require PM approval, confidence-based auto-send, or full auto-send |
| Deliver | Jira comment, email through Resend, Slack message, and in-app notification |

The brief agent is instructed to provide implementation guidance, not a full patch or fabricated code.

### Notifications and dashboard

The app includes in-app notifications, optional Slack alerts, dashboard stats, setup status checks, and failure reporting for Jira and brief delivery.

## Current Pipeline

```text
Transcript source
  -> provider parser / manual upload
  -> normalize utterances
  -> store transcript in Supabase
  -> enqueue transcript-processing
  -> Claude extraction agent in the production app
  -> store extracted tasks
  -> route by confidence
       high confidence
         -> enqueue jira-creation
         -> requirements agent
         -> Jira issue
         -> create developer brief
         -> repo analysis
         -> optional approval
         -> Jira comment / email / Slack delivery
       medium or low confidence
         -> interview queue
         -> human, AI chat, or voice clarification
         -> enqueue jira-creation
```

## Testing Status

The repo has two useful smoke paths:

| Test | What it proves |
|---|---|
| `pnpm test:pipeline` | Runs the mocked end-to-end pipeline through upload, extraction, Jira creation, repo brief generation, and email delivery without calling external services |
| `pnpm test:ai-pipeline` | Uses Claude, Groq, or Kimi with a noisy 10-minute Shiro standup transcript and judges whether the extracted ticket matches the intended repo problem; Jira creation is intentionally skipped |
| `pnpm test:groq-pipeline` | Compatibility command that forces the same AI smoke harness to use Groq |

The normal test suite is:

```bash
pnpm test
```

The production build check is:

```bash
pnpm build
```

`pnpm build` runs Vitest first, then `next build`.

## AI Smoke Harness

The production app pipeline currently uses Claude for structured extraction, interviews, requirements, routing, and developer prompt packs. The standalone smoke harness is provider-flexible: it can run with Claude, Groq, or Kimi so a team can validate raw transcript-to-ticket behavior with whichever key they already have.

Run with automatic provider selection:

```bash
pnpm test:ai-pipeline
```

The script chooses the first configured key in this order: Claude, Groq, Kimi.

Run with a specific provider:

```bash
AI_SMOKE_PROVIDER=claude ANTHROPIC_API_KEY=... pnpm test:ai-pipeline
AI_SMOKE_PROVIDER=groq GROQ_API_KEY=... pnpm test:ai-pipeline
AI_SMOKE_PROVIDER=kimi KIMI_API_KEY=... pnpm test:ai-pipeline
```

The old Groq-specific command still works:

```bash
GROQ_API_KEY=... pnpm test:groq-pipeline
```

Optional environment variables:

| Variable | Purpose |
|---|---|
| `AI_SMOKE_PROVIDER` | `claude`, `groq`, or `kimi`; omit to auto-select |
| `ANTHROPIC_MODEL` | Claude model override, default `claude-sonnet-4-20250514` |
| `GROQ_MODEL` | Groq model override, default `llama-3.3-70b-versatile` |
| `KIMI_MODEL` | Kimi model override, default `kimi-k2.6` |
| `KIMI_BASE_URL` | Kimi OpenAI-compatible endpoint, default `https://api.moonshot.ai/v1` |
| `SHIRO_REPO_PATH` | Local checkout path for the Shiro repo evidence |
| `AI_PIPELINE_OUTPUT_DIR` | Output directory for transcript and JSON report |

The script writes:

| File | Contents |
|---|---|
| `shiro-standup-transcript.txt` | The raw transcript sent into the extraction test |
| `ai-pipeline-report.json` | Provider, model, evidence, extracted ticket, judge result, and pass/fail result |

## Stack

| Layer | Current choice |
|---|---|
| App | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Database/Auth/Realtime | Supabase |
| AI in app pipeline | Claude via Vercel AI SDK |
| External smoke model | Claude, Groq, or Kimi |
| Issue tracking | Jira Cloud REST API |
| Jobs | Vercel Queues |
| Optional rate limiting | Redis |
| Email | Resend |
| Notifications | In-app plus optional Slack webhook |
| Repo reader | GitHub token or Composio GitHub connected account |

## Quick Start

Install dependencies:

```bash
pnpm install
```

Start the full local development environment:

```bash
pnpm dev:all
```

This script checks prerequisites, starts Supabase, applies migrations, writes generated local Supabase credentials into `.env.local`, starts Redis when available, and runs the Next.js dev server.

Start only the Next.js app:

```bash
pnpm dev
```

Stop local services:

```bash
./scripts/stop.sh
```

## Environment

Copy `.env.example` to `.env.local` or let `pnpm dev:all` create `.env.local` for generated local Supabase values.

Minimum for local UI and database work:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase API URL |
| `SUPABASE_SERVICE_KEY` | Server-side Supabase access |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase anon key |

Needed for the full AI and delivery pipeline:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude extraction, requirements, interviews, and repo briefs |
| `JIRA_BASE_URL` | Jira Cloud site URL |
| `JIRA_EMAIL` | Jira API user |
| `JIRA_API_TOKEN` | Jira API token |
| `JIRA_DEFAULT_PROJECT` | Fallback Jira project key |
| `RESEND_API_KEY` | Email delivery |
| `EMAIL_FROM` | Sender address for developer brief emails |
| `WEBHOOK_SECRET` | Auth for provider and n8n webhooks |
| `CRON_SECRET` | Auth for maintenance cron |

Optional integrations:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Realtime voice interview support |
| `SLACK_WEBHOOK_URL` | Slack notifications |
| `GITHUB_READONLY_TOKEN` | Direct GitHub repo reading for briefs |
| `COMPOSIO_API_KEY` | Composio-backed repo reading |
| `COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID` | Connected GitHub account for Composio |
| `REDIS_URL` / `REDIS_HOST` / `REDIS_PORT` | Local rate limiting support |
| `VERCEL_REGION` | Vercel Queue region, default `iad1` |
| `AI_SMOKE_PROVIDER` | Optional AI smoke harness provider: `claude`, `groq`, or `kimi` |
| `GROQ_API_KEY` | Groq key for standalone AI smoke testing |
| `KIMI_API_KEY` | Kimi/Moonshot key for standalone AI smoke testing |
| `KIMI_BASE_URL` | Kimi OpenAI-compatible endpoint |

## Local Supabase Ports

The checked-in local Supabase config uses the `553xx` port range to avoid collisions with other Supabase projects:

| Service | Local URL / port |
|---|---|
| API | `http://127.0.0.1:55321` |
| Database | `postgresql://postgres:postgres@127.0.0.1:55322/postgres` |
| Studio | `http://127.0.0.1:55323` |
| Inbucket | `http://127.0.0.1:55324` |
| Analytics | `55327` |
| Pooler | `55329` |

## Useful Commands

| Command | What it does |
|---|---|
| `pnpm dev:all` | Start Supabase, migrations, Redis if available, and Next dev |
| `pnpm dev` | Start only Next dev |
| `pnpm test` | Run the Vitest suite |
| `pnpm test:pipeline` | Run the mocked full pipeline smoke test |
| `pnpm test:ai-pipeline` | Run transcript-to-ticket smoke test with Claude, Groq, or Kimi |
| `pnpm test:groq-pipeline` | Run the same smoke harness with Groq forced |
| `pnpm build` | Run tests and build Next |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm test:coverage` | Run coverage |
| `./scripts/stop.sh` | Stop local Supabase and related dev services |

## What Is Still Conditional

These pieces exist in code, but require real credentials and connected accounts to work outside the mocked smoke test:

| Capability | Requirement |
|---|---|
| Real Claude extraction and brief generation | `ANTHROPIC_API_KEY` |
| External AI smoke with Claude/Groq/Kimi | One of `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, or `KIMI_API_KEY` |
| Real Jira issue creation | Jira env vars and project configuration |
| Real email delivery | Resend API key and verified/supported sender |
| Real Slack delivery | Slack webhook URL |
| Real repo context for developer briefs | GitHub token or Composio connected account |
| Voice interview completion | OpenAI API key and browser voice flow |
| Webhook ingestion | `WEBHOOK_SECRET` and provider/n8n setup |

The mocked pipeline test proves the orchestration and data flow. It does not prove that a production Jira, Resend, Slack, Groq, Claude, or GitHub account is correctly configured.

## Repository Notes

The public GitHub repository is:

```text
abhisheksharma001/scrum-manager
```
