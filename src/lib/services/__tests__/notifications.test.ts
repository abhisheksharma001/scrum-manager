import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  notifyNewInterviews,
  notifyAutoCreatedTasks,
  notifyPushFailed,
  notifyInterviewCompleted,
  notifyClaimExpiring,
  notify,
} from "../notifications";
import type { TranscriptRow, ExtractedTaskRow } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabase";

const mockFetch = vi.fn();

const transcript: TranscriptRow = {
  id: "t-1",
  provider: "manual",
  external_id: "ext-1",
  meeting_title: "Sprint Planning",
  meeting_date: "2026-03-26T10:00:00Z",
  duration: 3600,
  attendees: [],
  utterance_count: 10,
  status: "completed",
  error_message: null,
  processed_at: null,
  created_at: "2026-03-26T00:00:00Z",
  updated_at: "2026-03-26T00:00:00Z",
};

function makeTask(overrides: Partial<ExtractedTaskRow> = {}): ExtractedTaskRow {
  return {
    id: "task-1",
    transcript_id: "t-1",
    extracted_title: "Ship webhook",
    extracted_description: "desc",
    work_type: "code",
    repo_context_needed: false,
    approval_status: "not_ready",
    approved_by: null,
    approved_at: null,
    assigned_developer_name: null,
    assigned_developer_email: null,
    repo_confidence: null,
    routing_confidence: null,
    inferred_assignees: [],
    confidence: "high",
    missing_context: [],
    source_quotes: [],
    priority: "P1",
    labels: [],
    status: "pending_interview",
    claimed_by: null,
    claimed_at: null,
    claim_expires_at: null,
    dismissed_reason: null,
    interview_responses: null,
    tracker_project: null,
    tracker_issue_key: null,
    tracker_error: null,
    suggested_interviewer: null,
    created_at: "2026-03-26T00:00:00Z",
    updated_at: "2026-03-26T00:00:00Z",
    ...overrides,
  };
}

describe("notifications", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("notify (core)", () => {
    it("writes to database and sends Slack", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";

      await notify({
        type: "interview_needed",
        title: "Test notification",
        body: "Test body",
        link: "/test",
      });

      // DB insert
      expect(supabaseAdmin.from).toHaveBeenCalledWith("notifications");

      // Slack
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe("https://hooks.slack.com/test");
    });

    it("skips Slack when no webhook URL", async () => {
      delete process.env.SLACK_WEBHOOK_URL;

      await notify({
        type: "interview_needed",
        title: "Test",
      });

      // DB insert still happens
      expect(supabaseAdmin.from).toHaveBeenCalledWith("notifications");
      // Slack skipped
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips Slack when slack: false", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";

      await notify(
        { type: "claim_expiring", title: "Test" },
        { slack: false }
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("notifyNewInterviews", () => {
    it("sends notification when tasks are pending", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";

      await notifyNewInterviews(transcript, [makeTask()]);

      expect(supabaseAdmin.from).toHaveBeenCalledWith("notifications");
      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.blocks[0].text.text).toContain("Sprint Planning");
    });

    it("skips when no pending_interview tasks", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";

      await notifyNewInterviews(transcript, [
        makeTask({ status: "completed" }),
      ]);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not throw on network error", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        notifyNewInterviews(transcript, [makeTask()])
      ).resolves.not.toThrow();
    });
  });

  describe("notifyAutoCreatedTasks", () => {
    it("sends notification with Jira links", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
      process.env.JIRA_BASE_URL = "https://test.atlassian.net";

      await notifyAutoCreatedTasks(transcript, [
        { title: "Ship webhook", jiraKey: "ENG-123" },
      ]);

      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.blocks[1].text.text).toContain("ENG-123");
    });

    it("skips Slack when no webhook URL", async () => {
      delete process.env.SLACK_WEBHOOK_URL;

      await notifyAutoCreatedTasks(transcript, [
        { title: "Task", jiraKey: "ENG-1" },
      ]);

      // DB write still happens
      expect(supabaseAdmin.from).toHaveBeenCalledWith("notifications");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("notifyPushFailed", () => {
    it("sends failure notification", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";

      await notifyPushFailed("task-1", "Deploy monitoring", "Connection timeout");

      expect(supabaseAdmin.from).toHaveBeenCalledWith("notifications");
      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.blocks[0].text.text).toContain("failed");
    });
  });

  describe("notifyInterviewCompleted", () => {
    it("sends completion notification", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";

      await notifyInterviewCompleted("task-1", "Fix auth", "sean@ellavox.ai");

      expect(supabaseAdmin.from).toHaveBeenCalledWith("notifications");
      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.blocks[1].text.text).toContain("sean@ellavox.ai");
    });
  });

  describe("notifyClaimExpiring", () => {
    it("sends personal notification without Slack", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";

      await notifyClaimExpiring("user-1", "task-1", "Review API");

      // DB insert
      expect(supabaseAdmin.from).toHaveBeenCalledWith("notifications");
      // No Slack (personal notification)
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
