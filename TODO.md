# Ellavox Flow TODO

This TODO explains the product flow in plain language first, then adds the technical checks needed to make each step production-ready. It is written for project managers, scrum managers, and engineers looking at the same pipeline.

## End-to-End Flow

```text
1. Meeting happens
   -> Someone uploads a transcript, or n8n/provider webhook sends it in.

2. Transcript is stored
   -> Supabase saves the meeting, speakers, timestamps, and raw text.
   -> Duplicate files from the same provider are skipped.

3. Transcript is processed
   -> A queue job starts extraction.
   -> Claude reads the meeting and finds real action items.

4. Each action item gets a confidence score
   -> High confidence means the system has enough information.
   -> Medium or low confidence means a human should clarify something.

5A. High-confidence item
   -> Requirements are refined.
   -> Jira issue is created.
   -> Developer prompt pack is created.
   -> Repo context is read.
   -> Prompt pack can be sent to Jira, email, Slack, and in-app notifications.

5B. Medium/low-confidence item
   -> Item goes to the interview queue.
   -> A teammate claims it and answers missing questions.
   -> AI chat or voice flow can also collect answers.
   -> Once complete, it rejoins the Jira creation path.

6. Scrum/project manager reviews outcomes
   -> Check dashboard stats.
   -> Check pending interviews.
   -> Check failed Jira pushes.
   -> Check developer briefs waiting for approval or delivery.
```

## What A Non-Technical Manager Should Watch

| Stage | Good sign | Needs attention |
|---|---|---|
| Transcript intake | Meeting appears in the transcript list | Transcript missing or duplicate unexpectedly skipped |
| Extraction | Tasks appear with clear titles and owners | Too many vague tasks, casual chatter extracted, or no task found |
| Confidence routing | Clear work goes straight to Jira, unclear work asks questions | Everything is low confidence or everything auto-creates too aggressively |
| Interview queue | Missing info questions are specific | Questions are too broad or the wrong person is suggested |
| Jira creation | Ticket has acceptance criteria and priority | Ticket is vague, wrong project, wrong assignee, or Jira push fails |
| Developer brief | Prompt pack names files, constraints, tests, and non-goals | Prompt pack invents files or gives generic advice |
| Delivery | Email/Jira/Slack show the same useful prompt pack | Delivery fails or recipients are missing |

## Current Engineering TODO

## Current Patches And Permanent Fixes

| Patch / temporary bridge | Why it exists | Permanent fix |
|---|---|---|
| AI smoke harness supports Claude/Groq/Kimi, but production agents still use Claude | This lets teams test transcript-to-ticket reasoning with whichever key they have, without changing production behavior or creating Jira issues | Build a shared production AI provider layer used by extraction, interview, requirements, routing, and repo brief agents |
| Groq smoke command is now a compatibility wrapper | Existing users may still run the old Groq-specific command | Keep it for one release, then document only `pnpm test:ai-pipeline` |
| Setup UI separates production AI from AI smoke readiness | Production app needs Claude today, while external smoke can use Claude/Groq/Kimi | Once production provider abstraction exists, let the setup page configure/select the active provider |
| Queue client falls back to `iad1` when `VERCEL_REGION` is missing | Local and non-Vercel environments need a deterministic queue region | Validate queue region at boot/deploy time and show it in setup health |
| Service re-export files keep old imports working | The app moved toward agent modules without breaking callers | Update callers to import agents directly, then remove compatibility service wrappers |
| Brief renderer creates a fallback execution pack when older briefs lack one | Existing rows may not have the newer `execution_pack` shape | Backfill old briefs or enforce generated `execution_pack` before delivery |
| Zoom and MS Teams providers parse webhook shells but do not fetch transcripts yet | Provider scaffolding exists before full API wiring | Implement real OAuth/API fetch, signature validation, transcript download, and participant resolution |
| Supabase RLS insert fallback allows authenticated inserts in some tables | It helped local/dev flows while service-role processing was being stabilized | Tighten policies so server/service-role paths insert system rows, and browser users only perform explicit user actions |

### 1. AI provider support

Current state:
- Production app pipeline uses Claude.
- Standalone smoke harness supports Claude, Groq, and Kimi.

Next:
- Decide whether Groq/Kimi should also power the production extraction/requirements/brief agents.
- If yes, add a shared production AI provider abstraction instead of only the smoke harness abstraction.
- Add provider choice to Supabase `pipeline_config` only after production agents support it.

### 2. Smoke testing

Current state:
- `pnpm test:pipeline` proves the mocked full app pipeline.
- `pnpm test:ai-pipeline` proves raw transcript-to-ticket extraction with Claude, Groq, or Kimi.

Next:
- Add CI coverage for `pnpm test:pipeline`.
- Keep external AI smoke runs manual unless test keys are available in CI.
- Store smoke outputs as artifacts when running in GitHub Actions.

### 3. Jira production readiness

Current state:
- Jira issue creation, retry, project routing, assignee lookup, and watcher logic exist.

Next:
- Test against a real Jira sandbox project.
- Confirm story points custom field per workspace.
- Add a PM-facing retry/recovery checklist for failed pushes.

### 4. Developer prompt pack delivery

Current state:
- Prompt packs can be delivered through Jira comments, Resend email, Slack, and in-app notifications.

Next:
- Verify sender/domain setup in Resend.
- Confirm recipient rules when assignee email is missing.
- Decide which brief approval mode is safest for launch: manual gate, confidence gate, or auto-send.

### 5. Transcript sources

Current state:
- Manual upload and n8n webhook are the easiest paths to test.
- Provider routes exist for Google Meet, Zoom, and MS Teams, but provider setup still needs real account wiring.

Next:
- Finish one production ingestion path first, preferably n8n Google Drive or manual upload.
- Add a small sample transcript pack for demos.
- Document expected transcript format for users.

### 6. PM/scrum manager UX

Current state:
- Dashboard, tasks, interviews, briefs, setup, and notifications pages exist.

Next:
- Add a single "Pipeline Health" view that shows:
  - transcripts waiting
  - tasks extracted
  - interviews pending
  - Jira failures
  - prompt packs waiting for approval
  - delivery failures
- Add plain-language labels for statuses such as `pending_interview`, `jira_failed`, and `awaiting_pm_review`.

## Launch Checklist

```text
Local proof
  [ ] pnpm install
  [ ] pnpm test:pipeline
  [ ] pnpm build
  [ ] Optional: pnpm test:ai-pipeline with Claude, Groq, or Kimi

Environment
  [ ] Supabase URL and keys
  [ ] Anthropic key for production app pipeline
  [ ] Optional Groq or Kimi key for external smoke testing
  [ ] Jira URL, email, token, default project
  [ ] Resend key and sender
  [ ] Slack webhook if notifications are needed
  [ ] GitHub or Composio repo reader if prompt packs need repo context

Operational proof
  [ ] Upload one realistic transcript
  [ ] Confirm tasks are extracted
  [ ] Confirm at least one high-confidence task creates a Jira issue
  [ ] Confirm one unclear task enters interview flow
  [ ] Complete the interview and confirm Jira creation
  [ ] Generate and deliver one developer prompt pack
```
