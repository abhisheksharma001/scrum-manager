// ─── Transcript Provider Types ───────────────────────────────────────────────

export type TranscriptProvider = "google-meet" | "zoom" | "ms-teams" | "manual" | "n8n";

export type TranscriptStatus = "pending" | "processing" | "completed" | "failed";

export interface Attendee {
  name: string;
  email?: string;
  providerId?: string;
}

export interface Utterance {
  speaker: string;
  speakerEmail?: string;
  text: string;
  startTime: number; // seconds from meeting start
  endTime: number;
}

export interface NormalizedTranscript {
  provider: TranscriptProvider;
  externalId: string;
  meetingTitle: string;
  meetingDate: Date;
  duration: number; // seconds
  attendees: Attendee[];
  utterances: Utterance[];
  rawFormat: "json" | "vtt" | "text";
  metadata: Record<string, unknown>;
}

// ─── Task Extraction Types ──────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";
export type Priority = "P0" | "P1" | "P2" | "P3";

export type TaskStatus =
  | "pending_interview"
  | "claimed"
  | "completed"
  | "dismissed"
  | "auto_created"
  | "expired"
  | "jira_failed";

export type BriefStatus =
  | "queued"
  | "analyzing"
  | "awaiting_pm_review"
  | "needs_human_direction"
  | "sending"
  | "sent"
  | "rejected"
  | "failed";

export type BriefConfidence = "high" | "medium" | "low" | "none";

export interface ProjectRepoMapping {
  id: string;
  project_key: string;
  repo_full_name: string;
  is_primary: boolean;
  paths_hint: string | null;
  created_at: string;
}

export interface DeveloperBrief {
  task_name: string;
  assignee: string | null;
  tracker_key: string | null;
  tracker_url: string | null;
  repos: string[];
  files_likely_involved: Array<{ path: string; reason: string }>;
  existing_code_summary: string;
  task_restated: string;
  suggested_approach: string[];
  key_considerations: string[];
  risks: string[];
  estimated_complexity: {
    level: "trivial" | "small" | "medium" | "large" | "unknown";
    rationale: string;
  };
  dependencies: string[];
  suggested_tests: string[];
  execution_pack?: {
    plain_language_logic: string[];
    technical_logic: Array<{
      area: string;
      change: string;
      notes?: string;
    }>;
    implementation_steps: string[];
    code_guidance: Array<{
      file: string | null;
      guidance: string;
      example?: string;
    }>;
    tests_to_run: string[];
    agent_prompt: string;
  };
  sample_snippets?: Array<{
    path: string | null;
    language: string;
    code: string;
    purpose: string;
  }>;
  confidence: BriefConfidence;
  missing_info: string[];
}

export interface DeveloperBriefRow {
  id: string;
  task_id: string;
  tracker_issue_key: string | null;
  status: BriefStatus;
  repos: string[];
  analyzed_commit_sha: string | null;
  candidate_files: Array<{ path: string; score?: number; reason?: string }>;
  brief: DeveloperBrief | null;
  confidence: BriefConfidence | null;
  missing_info: string[];
  model: string | null;
  token_usage: Record<string, unknown> | null;
  tool_calls: number;
  bytes_read: number;
  attempt: number;
  pm_reviewer: string | null;
  pm_reviewed_at: string | null;
  pm_action: string | null;
  delivery: Record<string, unknown>;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedTask {
  title: string;
  description: string;
  inferredAssignees: { name: string; email?: string }[];
  confidence: Confidence;
  missingContext: string[];
  sourceQuotes: { speaker: string; text: string; timestamp: number }[];
  priority: Priority;
  labels: string[];
  suggestedInterviewer?: { name: string; email?: string } | null;
}

// ─── Database Row Types ─────────────────────────────────────────────────────

export interface TranscriptRow {
  id: string;
  provider: TranscriptProvider;
  external_id: string;
  meeting_title: string;
  meeting_date: string;
  duration: number;
  attendees: Attendee[];
  utterance_count: number;
  status: TranscriptStatus;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedTaskRow {
  id: string;
  transcript_id: string;
  extracted_title: string;
  extracted_description: string;
  inferred_assignees: { name: string; email?: string }[];
  confidence: Confidence;
  missing_context: string[];
  source_quotes: { speaker?: string; text: string; timestamp: number }[];
  priority: Priority;
  labels: string[];
  suggested_interviewer: { name: string; email?: string } | null;
  status: TaskStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  dismissed_reason: string | null;
  interview_responses: Record<string, string> | null;
  tracker_project: string | null;
  tracker_issue_key: string | null;
  tracker_error: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (optional, from queries)
  transcript?: TranscriptRow;
}

export interface TaskStatusHistoryRow {
  id: string;
  task_id: string;
  old_status: string;
  new_status: string;
  changed_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  google_id: string | null;
  jira_account_id: string | null;
  slack_user_id: string | null;
  role: "admin" | "member";
  preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PipelineConfigRow {
  id: string;
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: string;
}

// ─── API Types ──────────────────────────────────────────────────────────────

export interface ExtractionResult {
  tasks: ExtractedTask[];
  transcriptId: string;
  processingTimeMs: number;
}

export type { IssueCreateResult } from "@/lib/issue-tracker";
export type { IssueCreateResult as JiraCreateResult } from "@/lib/issue-tracker";

export interface InterviewSubmission {
  responses: Record<string, string>;
  assignee?: string;
  priority?: Priority;
  labels?: string[];
}

// ─── Config Keys ────────────────────────────────────────────────────────────

export const CONFIG_KEYS = {
  CONFIDENCE_AUTO_CREATE_THRESHOLD: "confidence_auto_create_threshold",
  INTERVIEW_EXPIRY_HOURS: "interview_expiry_hours",
  CLAIM_TIMEOUT_MINUTES: "claim_timeout_minutes",
  JIRA_DEFAULT_PROJECT: "jira_default_project",
  ACTIVE_PROVIDERS: "active_providers",
  NOTIFICATION_CHANNELS: "notification_channels",
  DUPLICATE_SIMILARITY_THRESHOLD: "duplicate_similarity_threshold",
  PROJECT_ROUTES: "project_routes",
  BRIEF_APPROVAL_MODE: "brief_approval_mode",
  AUTO_SEND_MIN_CONFIDENCE: "auto_send_min_confidence",
  BRIEF_BUDGET: "brief_budget",
} as const;
