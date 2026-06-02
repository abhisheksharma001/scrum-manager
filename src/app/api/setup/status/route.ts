import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);

    const integrations: Record<
      string,
      { configured: boolean; label: string }
    > = {
      "google-meet": {
        label: "Google Meet",
        configured: Boolean(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ),
      },
      jira: {
        label: "Jira",
        configured: Boolean(
          process.env.JIRA_BASE_URL &&
            process.env.JIRA_EMAIL &&
            process.env.JIRA_API_TOKEN
        ),
      },
      "ai-provider": {
        label: "AI Provider",
        configured: Boolean(process.env.ANTHROPIC_API_KEY),
      },
      "ai-smoke": {
        label: "AI Smoke",
        configured: Boolean(
          process.env.ANTHROPIC_API_KEY ||
            process.env.GROQ_API_KEY ||
            process.env.KIMI_API_KEY ||
            process.env.MOONSHOT_API_KEY
        ),
      },
      slack: {
        label: "Slack",
        configured: Boolean(process.env.SLACK_WEBHOOK_URL),
      },
      supabase: {
        label: "Supabase",
        configured: Boolean(
          process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
        ),
      },
      redis: {
        label: "Redis",
        configured: Boolean(
          process.env.REDIS_HOST || process.env.REDIS_URL
        ),
      },
    };

    return NextResponse.json({
      integrations,
      jiraBaseUrl: process.env.JIRA_BASE_URL?.replace(/\/+$/, "") || null,
    });
  } catch (err) {
    return apiError(err, { route: "setup/status" });
  }
}
