# Ellavox

**Meetings produce action items. Most of them die.** They get buried in notes, lost in Slack threads, or scribbled on whiteboards that nobody photographs. The gap between "we said we'd do this" and "there's a tracked ticket for it" is where accountability goes to disappear.

Ellavox closes that gap. Upload a meeting transcript. Get structured, assigned, routed Jira tickets out the other side — automatically.

---

## The Problem

After every meeting, someone is supposed to:
1. Review the notes and pull out action items
2. Figure out who owns each one
3. Write up the details with enough context to be useful
4. Create tickets in the right project board
5. Assign them to the right people

In practice, **this takes 20-45 minutes per meeting** and happens inconsistently. Important work falls through the cracks. Teams lose trust in meetings as a coordination tool.

## What Ellavox Does

**Transcript in. Jira tickets out. Human only when needed.**

```
Meeting Recording
       ↓
   Transcript
       ↓
  ┌─────────────────────────────────┐
  │  AI extracts every action item  │
  │  with title, owner, priority,   │
  │  and confidence level            │
  └─────────────────────────────────┘
       ↓                    ↓
   High confidence      Low confidence
       ↓                    ↓
  Auto-creates         AI interviews a
  the Jira ticket      team member to
  immediately          fill context gaps
                            ↓
                       Then creates
                       the ticket
```

**What comes out:** Fully structured Jira cards with acceptance criteria, story points, correct project routing, and the right assignee — not a vague reminder, but a spec a developer can pick up and work from.

---

## The Gap It Eliminates

| Before Ellavox | After Ellavox |
|---|---|
| 20-45 min of manual ticket creation per meeting | Zero — happens automatically |
| Action items lost in notes nobody re-reads | Every commitment becomes a tracked ticket |
| Vague tickets like "look into the payment thing" | Structured specs with acceptance criteria |
| Tickets land in one catch-all board | AI routes each task to the correct team board |
| No one knows who owns what | Assignees inferred from who said they'd do it |
| Follow-up requires chasing people | Assignments are immediate and visible |

---

## How the AI Decides When to Ask a Human

Not every action item from a meeting is crystal clear. Ellavox uses **confidence-based routing** to handle ambiguity without blocking the pipeline:

| Confidence | What Happens | Example |
|---|---|---|
| **High** | AI creates the Jira ticket autonomously | "Sean will ship the webhook integration by Friday" |
| **Medium/Low** | AI conducts a short interview to fill gaps, then creates the ticket | "We should probably look into that payment issue" |

The interview isn't a form. It's a focused AI conversation — 2-3 targeted questions based on exactly what the AI couldn't figure out from the transcript. Voice or text. Takes under 2 minutes.

**The human is never an approval gate. They're a context provider** — called in only when the AI has identified a specific gap it can't fill, released the moment that gap is closed.

---

## The Interview → Ticket → Execution Pipeline

Here's the full lifecycle of an ambiguous action item — from a vague meeting comment to a ticket a human or agent can execute:

```
"We should probably fix that payment retry thing before launch"
                            ↓
              ┌─────────────────────────────┐
              │  EXTRACTION                 │
              │  AI identifies this as a    │
              │  task but flags it LOW       │
              │  confidence — no owner, no  │
              │  scope, no timeline          │
              └─────────────────────────────┘
                            ↓
              ┌─────────────────────────────┐
              │  INTERVIEW                  │
              │  AI asks the team:          │
              │  "Who owns payment retry?"  │
              │  "What's broken exactly?"   │
              │  "Is this blocking launch?" │
              │                             │
              │  → Sean owns it             │
              │  → Stripe webhook drops     │
              │    after 3rd retry          │
              │  → Yes, blocking for v2.1   │
              └─────────────────────────────┘
                            ↓
              ┌─────────────────────────────┐
              │  REQUIREMENTS               │
              │  AI writes a full spec:     │
              │  • Title: Fix Stripe        │
              │    webhook retry failure    │
              │  • Type: Bug                │
              │  • 5 acceptance criteria    │
              │  • Story points: 3          │
              │  • Priority: P1             │
              └─────────────────────────────┘
                            ↓
              ┌─────────────────────────────┐
              │  ROUTING                    │
              │  AI reads your board        │
              │  descriptions and routes    │
              │  to: ENG (backend/infra)    │
              └─────────────────────────────┘
                            ↓
              ┌─────────────────────────────┐
              │  JIRA / ASANA               │
              │  Ticket created with:       │
              │  • Structured description   │
              │  • Acceptance criteria as   │
              │    checkboxes               │
              │  • Assigned to Sean         │
              │  • Story points + priority  │
              │  • Source quotes from the   │
              │    meeting                  │
              └─────────────────────────────┘
                            ↓
                 Ready to be worked by
                 a human or a downstream
                 agent
```

### What lands in your project management tool

The ticket Ellavox creates isn't a reminder — it's a **workable spec**:

| Field | What the AI produces |
|---|---|
| **Title** | Clear, imperative ("Fix Stripe webhook retry failure after 3rd attempt") |
| **Description** | Full context: what was discussed, why it matters, constraints mentioned |
| **Acceptance criteria** | 3-7 testable checkboxes a developer can work through |
| **Issue type** | Story, Task, Bug, or Spike — inferred from the discussion |
| **Story points** | Fibonacci estimate based on scope and complexity |
| **Priority** | P0-P3 based on urgency signals from the conversation |
| **Assignee** | Resolved from who said they'd own it |
| **Labels** | Auto-categorized (backend, frontend, infrastructure, etc.) |
| **Source quotes** | Exact excerpts from the transcript with timestamps |

### What happens next

Once the ticket exists on the right board, it's ready for execution — by people or by agents:

**Humans** pick up the ticket in their normal sprint workflow. The spec is detailed enough to start working immediately without re-reading meeting notes or asking "what did we mean by this?"

**Downstream agents** can watch specific boards and take further action:
- An engineering agent breaks stories into subtasks and suggests implementation approaches
- A sales agent enriches cards with CRM data and assigns regional owners
- A marketing agent schedules content tasks and links creative briefs
- A design agent attaches Figma references and manages review cycles

Ellavox handles the hardest handoff in the chain: **unstructured conversation → structured, routed work item.** Everything downstream builds on clean cards that already exist in the right place with the right detail.

---

## What It Supports

**Transcript sources:** Google Meet, Zoom, MS Teams, n8n (Google Drive automation), or manual upload (VTT/SRT/text)

**Interview modes:** AI chat, voice conversation (OpenAI Realtime), or manual form

**Notifications:** In-app notification bell + Slack alerts when interviews are needed, tasks are created, or pushes fail

**Project routing:** Define your Jira boards (Engineering, Sales, Marketing, etc.) with descriptions, and the AI automatically sorts each task to the right one

---

## Stack

| | |
|---|---|
| **App** | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| **Database** | Supabase (Postgres + Auth + Realtime) |
| **AI** | Claude (extraction, interviews, requirements, routing) |
| **Voice** | OpenAI Realtime API |
| **Issue tracking** | Jira Cloud REST API |
| **Notifications** | Slack webhooks + in-app |
| **Jobs** | Vercel Queues (Redis + BullMQ optional) |

---

## Quick Start

```bash
# Install
pnpm install

# Start everything (Supabase, Redis, worker, dev server)
pnpm dev:all

# Or just the Next.js dev server
pnpm dev
```

Copy `.env.example` to `.env` and fill in your keys. At minimum you need Supabase credentials and an Anthropic API key. Add Jira credentials to enable ticket creation, Slack webhook URL for notifications.

See the in-app **Setup** page for guided configuration of each integration.

---

## Why This Matters

The meeting-to-ticket pipeline is the most common, most manual, and most failure-prone handoff in knowledge work. Every team does it. Most do it badly.

Ellavox doesn't just automate the easy part. It handles the hard part — the ambiguous action items that need human context before they can become real work — through targeted AI interviews that take seconds instead of the back-and-forth that takes days.

The result: **every meeting produces accountable, trackable, well-structured work items, automatically.** No one has to remember to do it. No one has to spend 30 minutes writing tickets. Nothing falls through the cracks.
