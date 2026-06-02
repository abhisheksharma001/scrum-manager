# Claude / Codex Launch File

Use this file when opening the Ellavox repo in Claude Code, Codex, Cursor, or another coding agent. It tells the agent how to launch, verify, and explain the project without requiring the user to know the full technical setup.

## Project Summary

Ellavox converts meeting transcripts into structured work:

```text
transcript
  -> AI extracts action items
  -> confidence routing decides Jira vs interview
  -> interviews collect missing context
  -> Jira issues are created
  -> developer prompt packs are generated
  -> prompt packs can be delivered by Jira comment, email, Slack, and in-app notification
```

The production app pipeline currently uses Claude via `ANTHROPIC_API_KEY`. The standalone AI smoke harness can use Claude, Groq, or Kimi.

## First Commands

Run these from the repository root:

```bash
pnpm install
pnpm test:pipeline
```

If the user wants the local app running:

```bash
pnpm dev:all
```

If local Supabase/Docker is already running elsewhere and the user only wants the UI:

```bash
pnpm dev
```

Stop local services:

```bash
./scripts/stop.sh
```

## Environment Setup

Use `.env.example` as the source of truth.

Minimum local app values:

```text
SUPABASE_URL
SUPABASE_SERVICE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Production pipeline values:

```text
ANTHROPIC_API_KEY
JIRA_BASE_URL
JIRA_EMAIL
JIRA_API_TOKEN
JIRA_DEFAULT_PROJECT
WEBHOOK_SECRET
CRON_SECRET
```

Optional delivery and repo context:

```text
RESEND_API_KEY
EMAIL_FROM
SLACK_WEBHOOK_URL
GITHUB_READONLY_TOKEN
COMPOSIO_API_KEY
COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID
```

Optional AI smoke values:

```text
AI_SMOKE_PROVIDER=claude|groq|kimi
ANTHROPIC_API_KEY
GROQ_API_KEY
KIMI_API_KEY
KIMI_BASE_URL=https://api.moonshot.ai/v1
```

## AI Smoke Harness

Use this when the user wants to test transcript-to-ticket reasoning without sending anything to Jira:

```bash
pnpm test:ai-pipeline
```

Provider-specific examples:

```bash
AI_SMOKE_PROVIDER=claude ANTHROPIC_API_KEY=... pnpm test:ai-pipeline
AI_SMOKE_PROVIDER=groq GROQ_API_KEY=... pnpm test:ai-pipeline
AI_SMOKE_PROVIDER=kimi KIMI_API_KEY=... pnpm test:ai-pipeline
```

The script writes the raw transcript and JSON report to `/private/tmp` by default. It intentionally skips Jira creation.

## Verification Rules

Before claiming the project works:

```bash
pnpm test:pipeline
pnpm build
```

What these mean:

| Command | Meaning |
|---|---|
| `pnpm test:pipeline` | Mocked full data flow: upload, extraction, Jira, repo brief, email delivery |
| `pnpm build` | Full Vitest suite plus Next production build |
| `pnpm test:ai-pipeline` | External AI reasoning smoke with Claude/Groq/Kimi, no Jira |

Do not claim real Jira, Resend, Slack, Claude, Groq, Kimi, or GitHub delivery works unless the matching credentials were configured and the flow was actually run.

## PM-Friendly Explanation

When explaining the system to a non-technical project manager or scrum manager, use this version:

```text
1. A meeting transcript comes in.
2. Ellavox finds the real action items.
3. Clear items become Jira tickets automatically.
4. Unclear items ask a teammate focused follow-up questions.
5. Once the missing context is answered, the item becomes a Jira ticket.
6. Ellavox can also prepare a developer prompt pack so a human or coding agent knows exactly what to build.
7. The manager watches pending interviews, Jira failures, and prompt packs that need approval.
```

## Important Files

| File | Why it matters |
|---|---|
| `README.md` | Current capability and setup documentation |
| `TODO.md` | Flow-based launch/readiness checklist |
| `.env.example` | Environment variables |
| `scripts/dev.sh` | Local all-in-one launcher |
| `scripts/ai-pipeline-smoke.ts` | Claude/Groq/Kimi smoke harness |
| `test/pipeline-smoke.test.ts` | Mocked end-to-end pipeline test |
| `src/lib/jobs/processors.ts` | Queue processor flow |
| `src/lib/agents/*` | AI extraction, requirements, routing, interviews, repo brief logic |
| `src/app/setup/page.tsx` | Setup UI shown to users |

## Guardrails For Agents

- Keep production claims honest: Claude powers the production app pipeline today.
- Groq and Kimi are supported by the standalone smoke harness today.
- Do not expose real API keys in commits or logs.
- Do not create Jira issues during smoke tests unless the user explicitly asks and credentials are configured.
- Use `pnpm test:pipeline` before saying the pipeline still works.
- Use `pnpm build` before saying the app is production-build clean.
