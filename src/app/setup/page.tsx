"use client";

import { useState, useEffect } from "react";

interface ConfigStatus {
  configured: boolean;
  label: string;
}

interface IntegrationStatus {
  [key: string]: ConfigStatus;
}

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
      style={{
        backgroundColor: configured ? "var(--success-muted)" : "var(--warning-muted)",
        color: configured ? "var(--success)" : "var(--warning)",
      }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${configured ? "" : "animate-pulse-dot"}`}
        style={{ backgroundColor: configured ? "var(--success)" : "var(--warning)" }}
      />
      {configured ? "Configured" : "Not configured"}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-[10px] font-medium text-[var(--foreground-tertiary)] hover:text-[var(--accent)] transition-colors"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function EnvVar({ name, placeholder }: { name: string; placeholder?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-[var(--background-secondary)] border border-[var(--border-subtle)] px-3 py-2 font-mono text-[12px]">
      <span>
        <span className="text-[var(--accent)]">{name}</span>
        {placeholder && <span className="text-[var(--foreground-tertiary)]">={placeholder}</span>}
      </span>
      <CopyButton text={name} />
    </div>
  );
}

function SectionCard({ id, title, status, children }: { id: string; title: string; status?: ConfigStatus; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {status && <StatusBadge configured={status.configured} />}
      </div>
      <div className="flex flex-col gap-4 px-5 py-5">{children}</div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--accent-muted)] text-[10px] font-bold text-[var(--accent)]">{n}</span>
      <div className="text-[13px] leading-relaxed text-[var(--foreground-secondary)]">{children}</div>
    </div>
  );
}

export default function SetupPage() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => setStatus(data.integrations))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  const s = (key: string): ConfigStatus | undefined => status?.[key] ?? undefined;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Setup</h1>
        <p className="mt-1 text-[13px] text-[var(--foreground-secondary)]">
          Configure integrations and API keys to get the pipeline running.
        </p>
      </div>

      {!loading && status && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--foreground-tertiary)] mb-3">
            Integration Status
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {Object.entries(status).map(([key, val]) => (
              <a key={key} href={`#${key}`} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] font-medium hover:border-[var(--border-accent)] transition-all">
                <span>{val.label}</span>
                <span className={`h-2 w-2 rounded-full ${val.configured ? "" : "animate-pulse-dot"}`} style={{ backgroundColor: val.configured ? "var(--success)" : "var(--warning)" }} />
              </a>
            ))}
          </div>
        </div>
      )}

      <SectionCard id="google-meet" title="Google Meet" status={s("google-meet")}>
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          Ellavox uses the Google Workspace Events API and Pub/Sub to automatically receive meeting transcripts.
        </p>
        <div className="flex flex-col gap-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Prerequisites</h3>
          <ul className="ml-4 list-disc text-[13px] text-[var(--foreground-secondary)] space-y-1">
            <li>A Google Cloud project with billing enabled</li>
            <li>Google Workspace Business Standard or higher</li>
            <li>Admin access to the Google Workspace domain</li>
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Setup Steps</h3>
          <Step n={1}><p><strong className="text-[var(--foreground)]">Create OAuth 2.0 credentials</strong> in the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">Google Cloud Console</a>.</p></Step>
          <Step n={2}><p><strong className="text-[var(--foreground)]">Enable the required APIs</strong>: Meet REST, Workspace Events, Pub/Sub, Calendar.</p></Step>
          <Step n={3}><p><strong className="text-[var(--foreground)]">Create a Pub/Sub topic</strong> and push subscription pointing to <code className="rounded-md bg-[var(--background-secondary)] px-1.5 py-0.5 text-[11px] font-mono">{"{your-app-url}"}/api/webhooks/google-meet</code>.</p></Step>
          <Step n={4}><p><strong className="text-[var(--foreground)]">Configure domain-wide delegation</strong> (optional).</p></Step>
          <Step n={5}><p><strong className="text-[var(--foreground)]">Add the environment variables:</strong></p></Step>
        </div>
        <div className="flex flex-col gap-1.5">
          <EnvVar name="GOOGLE_CLIENT_ID" placeholder="your-client-id.apps.googleusercontent.com" />
          <EnvVar name="GOOGLE_CLIENT_SECRET" placeholder="GOCSPX-..." />
          <EnvVar name="GOOGLE_PUBSUB_TOPIC" placeholder="projects/your-project/topics/meet-transcripts" />
        </div>
      </SectionCard>

      <SectionCard id="jira" title="Jira" status={s("jira")}>
        <p className="text-[13px] text-[var(--foreground-secondary)]">Extracted action items are automatically created as Jira issues.</p>
        <div className="flex flex-col gap-4">
          <Step n={1}><p><strong className="text-[var(--foreground)]">Generate an API token</strong> at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">Atlassian API Tokens</a>.</p></Step>
          <Step n={2}><p><strong className="text-[var(--foreground)]">Identify your Jira instance URL</strong> (e.g. <code className="rounded-md bg-[var(--background-secondary)] px-1.5 py-0.5 text-[11px] font-mono">https://your-team.atlassian.net</code>).</p></Step>
          <Step n={3}><p><strong className="text-[var(--foreground)]">Choose a default project key</strong> (e.g. <strong>SCRUM</strong>-123).</p></Step>
        </div>
        <div className="flex flex-col gap-1.5">
          <EnvVar name="JIRA_BASE_URL" placeholder="https://your-team.atlassian.net" />
          <EnvVar name="JIRA_EMAIL" placeholder="you@example.com" />
          <EnvVar name="JIRA_API_TOKEN" placeholder="your-jira-api-token" />
          <EnvVar name="JIRA_DEFAULT_PROJECT" placeholder="SCRUM" />
        </div>
      </SectionCard>

      <SectionCard id="ai-provider" title="AI Provider" status={s("ai-provider")}>
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          The production app pipeline currently uses Claude for extraction, interviews, requirements, routing, and developer prompt packs.
        </p>
        <div className="flex flex-col gap-4">
          <Step n={1}><p><strong className="text-[var(--foreground)]">Create an account</strong> at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">console.anthropic.com</a>.</p></Step>
          <Step n={2}><p><strong className="text-[var(--foreground)]">Generate an API key</strong> from the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">API Keys page</a>.</p></Step>
        </div>
        <div className="flex flex-col gap-1.5">
          <EnvVar name="ANTHROPIC_API_KEY" placeholder="sk-ant-api03-..." />
        </div>
      </SectionCard>

      <SectionCard id="ai-smoke" title="AI Smoke Harness" status={s("ai-smoke")}>
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          The standalone transcript-to-ticket smoke test can run with Claude, Groq, or Kimi. This is useful when a team wants to validate the raw standup-to-ticket behavior before wiring Jira or email.
        </p>
        <div className="flex flex-col gap-4">
          <Step n={1}><p><strong className="text-[var(--foreground)]">Choose a smoke provider</strong> with <code className="rounded-md bg-[var(--background-secondary)] px-1.5 py-0.5 text-[11px] font-mono">AI_SMOKE_PROVIDER=claude</code>, <code className="rounded-md bg-[var(--background-secondary)] px-1.5 py-0.5 text-[11px] font-mono">groq</code>, or <code className="rounded-md bg-[var(--background-secondary)] px-1.5 py-0.5 text-[11px] font-mono">kimi</code>.</p></Step>
          <Step n={2}><p><strong className="text-[var(--foreground)]">Provide one matching key.</strong> If no provider is set, the script uses the first available key in this order: Claude, Groq, Kimi.</p></Step>
          <Step n={3}><p><strong className="text-[var(--foreground)]">Run the smoke test:</strong></p><pre className="mt-1 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-subtle)] p-3 font-mono text-[11px] text-[var(--foreground-secondary)] overflow-x-auto">pnpm test:ai-pipeline</pre></Step>
        </div>
        <div className="flex flex-col gap-1.5">
          <EnvVar name="AI_SMOKE_PROVIDER" placeholder="claude" />
          <EnvVar name="ANTHROPIC_API_KEY" placeholder="sk-ant-api03-..." />
          <EnvVar name="GROQ_API_KEY" placeholder="gsk_..." />
          <EnvVar name="KIMI_API_KEY" placeholder="sk-..." />
          <EnvVar name="KIMI_BASE_URL" placeholder="https://api.moonshot.ai/v1" />
        </div>
      </SectionCard>

      <SectionCard id="slack" title="Slack Notifications" status={s("slack")}>
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          Get notified when new interview items are ready or approved work is pushed to Jira.
          <span className="ml-1 text-[var(--foreground-tertiary)]">(Optional)</span>
        </p>
        <div className="flex flex-col gap-4">
          <Step n={1}><p><strong className="text-[var(--foreground)]">Create a Slack app</strong> at <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">api.slack.com/apps</a>.</p></Step>
          <Step n={2}><p><strong className="text-[var(--foreground)]">Enable Incoming Webhooks</strong> and add one to your workspace.</p></Step>
          <Step n={3}><p><strong className="text-[var(--foreground)]">Copy the webhook URL.</strong></p></Step>
        </div>
        <div className="flex flex-col gap-1.5">
          <EnvVar name="SLACK_WEBHOOK_URL" placeholder="https://hooks.slack.com/services/T.../B.../..." />
        </div>
      </SectionCard>

      <SectionCard id="supabase" title="Supabase (Database)" status={s("supabase")}>
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          For local development, <code className="text-[11px] font-mono text-[var(--accent)]">pnpm dev:all</code> starts Supabase automatically via Docker.
        </p>
        <div className="flex flex-col gap-1.5">
          <EnvVar name="SUPABASE_URL" placeholder="https://your-project.supabase.co" />
          <EnvVar name="SUPABASE_SERVICE_KEY" placeholder="eyJ..." />
          <EnvVar name="NEXT_PUBLIC_SUPABASE_URL" placeholder="https://your-project.supabase.co" />
          <EnvVar name="NEXT_PUBLIC_SUPABASE_ANON_KEY" placeholder="eyJ..." />
        </div>
      </SectionCard>

      <SectionCard id="redis" title="Redis (Rate Limiting)" status={s("redis")}>
        <p className="text-[13px] text-[var(--foreground-secondary)]">Redis is used for rate limiting. Optional — requests are allowed through if Redis is unavailable. Job queues use Vercel Queues.</p>
        <div className="flex flex-col gap-1.5">
          <EnvVar name="REDIS_HOST" placeholder="localhost" />
          <EnvVar name="REDIS_PORT" placeholder="6379" />
        </div>
      </SectionCard>

      <SectionCard id="env-reference" title="Environment Variables Reference">
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          Copy <code className="text-[11px] font-mono text-[var(--accent)]">.env.example</code> to <code className="text-[11px] font-mono text-[var(--accent)]">.env</code> and fill in your values.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left pb-2 pr-4">Variable</th>
                <th className="text-left pb-2 pr-4">Required</th>
                <th className="text-left pb-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {ENV_VARS.map((v) => (
                <tr key={v.name} className="border-b border-[var(--border-subtle)] last:border-b-0">
                  <td className="py-2 pr-4 font-mono text-[11px] text-[var(--accent)]">{v.name}</td>
                  <td className="py-2 pr-4">{v.required ? <span className="text-[var(--danger)] font-medium">Yes</span> : <span className="text-[var(--foreground-tertiary)]">No</span>}</td>
                  <td className="py-2 text-[var(--foreground-secondary)]">{v.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard id="quick-start" title="Quick Start">
        <div className="flex flex-col gap-4">
          <Step n={1}>
            <p><strong className="text-[var(--foreground)]">Install dependencies:</strong></p>
            <pre className="mt-1 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-subtle)] p-3 font-mono text-[11px] text-[var(--foreground-secondary)] overflow-x-auto">pnpm install</pre>
          </Step>
          <Step n={2}>
            <p><strong className="text-[var(--foreground)]">Copy the environment template:</strong></p>
            <pre className="mt-1 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-subtle)] p-3 font-mono text-[11px] text-[var(--foreground-secondary)] overflow-x-auto">{`cp .env.example .env\n# Edit .env with your API keys`}</pre>
          </Step>
          <Step n={3}>
            <p><strong className="text-[var(--foreground)]">Start everything:</strong></p>
            <pre className="mt-1 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-subtle)] p-3 font-mono text-[11px] text-[var(--foreground-secondary)] overflow-x-auto">pnpm dev:all</pre>
          </Step>
          <Step n={4}>
            <p><strong className="text-[var(--foreground)]">Open the app</strong> at <code className="rounded-md bg-[var(--background-secondary)] px-1.5 py-0.5 text-[11px] font-mono">http://localhost:3000</code> and upload a transcript.</p>
          </Step>
        </div>
      </SectionCard>
    </div>
  );
}

const ENV_VARS = [
  { name: "SUPABASE_URL", required: true, description: "Supabase project URL (auto-set by dev script locally)" },
  { name: "SUPABASE_SERVICE_KEY", required: true, description: "Supabase service role key for server-side access" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, description: "Supabase URL exposed to the browser" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, description: "Supabase anonymous key for client-side auth" },
  { name: "REDIS_HOST", required: false, description: "Redis host for rate limiting (default: localhost). Optional — falls back gracefully." },
  { name: "REDIS_PORT", required: false, description: "Redis port (default: 6379)" },
  { name: "ANTHROPIC_API_KEY", required: true, description: "Anthropic API key for the production Claude-powered pipeline" },
  { name: "AI_SMOKE_PROVIDER", required: false, description: "Smoke harness provider: claude, groq, or kimi" },
  { name: "GROQ_API_KEY", required: false, description: "Groq API key for the standalone AI pipeline smoke harness" },
  { name: "KIMI_API_KEY", required: false, description: "Kimi/Moonshot API key for the standalone AI pipeline smoke harness" },
  { name: "KIMI_BASE_URL", required: false, description: "Kimi OpenAI-compatible base URL (default: https://api.moonshot.ai/v1)" },
  { name: "JIRA_BASE_URL", required: true, description: "Your Atlassian instance URL" },
  { name: "JIRA_EMAIL", required: true, description: "Email of the Jira account that owns the API token" },
  { name: "JIRA_API_TOKEN", required: true, description: "Jira API token for authentication" },
  { name: "JIRA_DEFAULT_PROJECT", required: false, description: "Default Jira project key (default: SCRUM)" },
  { name: "SLACK_WEBHOOK_URL", required: false, description: "Slack incoming webhook URL for notifications" },
  { name: "WEBHOOK_SECRET", required: true, description: "Shared secret for transcript webhooks" },
  { name: "CRON_SECRET", required: false, description: "Bearer token for scheduled maintenance calls" },
  { name: "REPO_READER_PROVIDER", required: false, description: "Repo reader mode for prompt packs: direct or composio" },
  { name: "GITHUB_READONLY_TOKEN", required: false, description: "Read-only GitHub token when REPO_READER_PROVIDER=direct" },
  { name: "COMPOSIO_API_KEY", required: false, description: "Composio API key when REPO_READER_PROVIDER=composio" },
  { name: "COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID", required: false, description: "Connected GitHub account ID for Composio repo reads" },
  { name: "RESEND_API_KEY", required: false, description: "Resend API key for developer prompt pack emails" },
  { name: "EMAIL_FROM", required: false, description: "Sender address for developer prompt pack emails" },
  { name: "NEXT_PUBLIC_APP_URL", required: false, description: "Public URL of the app (default: http://localhost:3000)" },
  { name: "VERCEL_REGION", required: false, description: "Queue region for local/non-Vercel execution (default: iad1)" },
  { name: "LOG_LEVEL", required: false, description: "Logging verbosity: debug, info, warn, error" },
  { name: "GOOGLE_CLIENT_ID", required: false, description: "Google OAuth client ID for Meet integration" },
  { name: "GOOGLE_CLIENT_SECRET", required: false, description: "Google OAuth client secret" },
  { name: "GOOGLE_PUBSUB_TOPIC", required: false, description: "Pub/Sub topic for Meet transcript events" },
];
