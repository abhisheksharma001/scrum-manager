"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  useRealtimeInterview,
  type VoiceCompletion,
  type TranscriptEntry,
  type ConnectionStatus,
  type SpeakerState,
} from "@/hooks/use-realtime-interview";

interface Task {
  id: string;
  extracted_title: string;
  extracted_description: string;
  confidence: string;
  priority: string;
  missing_context: string[];
  source_quotes: Array<{ speaker?: string; text: string; timestamp: number }>;
  labels: string[];
  status: string;
  claimed_by: string | null;
  claim_expires_at: string | null;
  interview_responses: Record<string, string> | null;
  inferred_assignees: Array<{ name: string; email?: string }>;
  suggested_interviewer: { name: string; email?: string } | null;
  created_at: string;
  transcript?: {
    id: string;
    meeting_title: string;
    meeting_date: string;
    provider: string;
  };
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

interface ChatCompletion {
  interview_complete: boolean;
  title: string;
  description: string;
  assignee: string | null;
  priority: string;
  labels: string[];
  should_create: boolean;
}

const TEMP_USER_ID = "00000000-0000-0000-0000-000000000001";

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual interview state
  const [activeInterview, setActiveInterview] = useState<Task | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Voice interview state
  const [voiceTask, setVoiceTask] = useState<Task | null>(null);

  // AI chat interview state
  const [chatTask, setChatTask] = useState<Task | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatContext, setChatContext] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatCompletion, setChatCompletion] = useState<ChatCompletion | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchInterviews = useCallback(async () => {
    try {
      const res = await fetch("/api/interviews");
      const data = await res.json();
      setInterviews(data.interviews || []);
    } catch (err) {
      console.error("Failed to fetch interviews:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInterviews();
    const interval = setInterval(fetchInterviews, 30000);
    return () => clearInterval(interval);
  }, [fetchInterviews]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ─── AI Chat Interview ──────────────────────────────────────────────────

  async function startAIChat(task: Task) {
    setChatTask(task);
    setChatMessages([]);
    setChatCompletion(null);
    setChatLoading(true);

    try {
      const res = await fetch(`/api/interviews/${task.id}/ai-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();

      if (res.ok) {
        setChatContext(data.context);
        setChatMessages([{ role: "assistant", content: data.message }]);
      } else {
        setChatMessages([
          { role: "assistant", content: `Error starting interview: ${data.error}` },
        ]);
      }
    } catch {
      setChatMessages([
        { role: "assistant", content: "Failed to start AI interview." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function sendChatMessage() {
    if (!chatTask || !chatInput.trim() || chatLoading || chatCompletion) return;

    const userMsg = chatInput.trim();
    setChatInput("");

    const updatedHistory: ChatMessage[] = [
      ...chatMessages,
      { role: "user", content: userMsg },
    ];
    setChatMessages(updatedHistory);
    setChatLoading(true);

    try {
      const res = await fetch(`/api/interviews/${chatTask.id}/ai-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          message: userMsg,
          history: updatedHistory,
          context: chatContext,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        const displayMsg = data.message.replace(/```json[\s\S]*?```/g, "").trim();
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: displayMsg },
        ]);

        if (data.completion) {
          setChatCompletion(data.completion);
          setTimeout(fetchInterviews, 1500);
        }
      } else {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error}` },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to send message." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function closeChat() {
    setChatTask(null);
    setChatMessages([]);
    setChatContext("");
    setChatCompletion(null);
    fetchInterviews();
  }

  // ─── Manual Interview ───────────────────────────────────────────────────

  async function handleClaim(taskId: string) {
    try {
      const res = await fetch(`/api/interviews/${taskId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: TEMP_USER_ID }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveInterview(data.task);
        setResponses(data.task.interview_responses || {});
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error("Failed to claim:", err);
    }
  }

  const handleSave = useCallback(async () => {
    if (!activeInterview) return;
    try {
      await fetch(`/api/interviews/${activeInterview.id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: TEMP_USER_ID, responses }),
      });
    } catch (err) {
      console.error("Failed to save:", err);
    }
  }, [activeInterview, responses]);

  async function handleComplete() {
    if (!activeInterview) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/interviews/${activeInterview.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: TEMP_USER_ID, responses }),
      });
      if (res.ok) {
        setActiveInterview(null);
        setResponses({});
        fetchInterviews();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error("Failed to complete:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDismiss(taskId: string) {
    const reason = prompt("Why is this not a real task? (optional)");
    try {
      await fetch(`/api/interviews/${taskId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: TEMP_USER_ID,
          reason: reason || undefined,
        }),
      });
      if (activeInterview?.id === taskId) {
        setActiveInterview(null);
        setResponses({});
      }
      fetchInterviews();
    } catch (err) {
      console.error("Failed to dismiss:", err);
    }
  }

  async function handleRelease() {
    if (!activeInterview) return;
    try {
      await fetch(`/api/interviews/${activeInterview.id}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: TEMP_USER_ID }),
      });
      setActiveInterview(null);
      setResponses({});
      fetchInterviews();
    } catch (err) {
      console.error("Failed to release:", err);
    }
  }

  useEffect(() => {
    if (!activeInterview) return;
    const interval = setInterval(handleSave, 30000);
    return () => clearInterval(interval);
  }, [activeInterview, handleSave]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-6 w-40 skeleton" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 skeleton rounded-xl" />
        ))}
      </div>
    );
  }

  // ─── Voice Interview View ──────────────────────────────────────────────

  if (voiceTask) {
    return (
      <VoiceInterviewView
        task={voiceTask}
        onClose={() => {
          setVoiceTask(null);
          fetchInterviews();
        }}
      />
    );
  }

  // ─── AI Chat View ────────────────────────────────────────────────────────

  if (chatTask) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col animate-fade-in" style={{ height: "calc(100vh - 8rem)" }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">AI Interview</h1>
            <p className="text-[13px] text-[var(--foreground-secondary)]">{chatTask.extracted_title}</p>
          </div>
          <button
            onClick={closeChat}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium border border-[var(--border)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] transition-all"
          >
            Close
          </button>
        </div>

        {/* Task context */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-4">
          <div className="flex gap-2 flex-wrap items-center">
            <ConfidenceDot confidence={chatTask.confidence} />
            <PriorityDot priority={chatTask.priority} />
            {chatTask.transcript && (
              <span className="text-[11px] text-[var(--foreground-tertiary)]">
                from {chatTask.transcript.meeting_title}
              </span>
            )}
            {chatTask.suggested_interviewer && (
              <span className="text-[11px] text-[var(--accent)]">
                suggested: {chatTask.suggested_interviewer.name}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-[var(--foreground-secondary)] leading-relaxed">
            {chatTask.extracted_description}
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-0">
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-slide-in`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface)] border border-[var(--border)]"
                }`}
              >
                {msg.role === "assistant" && (
                  <p className="text-[10px] font-semibold text-[var(--purple)] mb-1.5 uppercase tracking-wider">
                    AI Interviewer
                  </p>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="flex justify-start animate-slide-in">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 text-[13px] text-[var(--foreground-tertiary)]">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground-tertiary)] animate-pulse-dot" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground-tertiary)] animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground-tertiary)] animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
                </div>
              </div>
            </div>
          )}

          {chatCompletion && (
            <div
              className={`rounded-xl border p-4 text-[13px] animate-fade-in ${
                chatCompletion.should_create
                  ? "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-muted)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {chatCompletion.should_create ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="font-semibold text-[var(--success)]">Interview complete</p>
                  </div>
                  <p className="text-[var(--foreground-secondary)] ml-6">
                    <span className="font-medium text-[var(--foreground)]">{chatCompletion.title}</span>
                    {" "}&middot;{" "}{chatCompletion.priority}
                    {chatCompletion.assignee && <> &rarr; {chatCompletion.assignee}</>}
                  </p>
                </div>
              ) : (
                <p className="font-medium text-[var(--foreground-tertiary)]">
                  Task dismissed &mdash; {chatCompletion.description}
                </p>
              )}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        {!chatCompletion ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder="Type your answer..."
              disabled={chatLoading}
              className="flex-1 rounded-xl disabled:opacity-40"
            />
            <button
              onClick={sendChatMessage}
              disabled={chatLoading || !chatInput.trim()}
              className="rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-5 py-2 text-[13px] font-semibold transition-all disabled:opacity-40"
            >
              Send
            </button>
          </div>
        ) : (
          <button
            onClick={closeChat}
            className="w-full rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-4 py-2.5 text-[13px] font-semibold transition-all"
          >
            Back to Queue
          </button>
        )}
      </div>
    );
  }

  // ─── Manual Interview View ────────────────────────────────────────────

  if (activeInterview) {
    return (
      <div className="max-w-2xl animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold tracking-tight">Manual Interview</h1>
          <div className="flex gap-2">
            <button
              onClick={handleRelease}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium border border-[var(--border)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] transition-all"
            >
              Release
            </button>
            <button
              onClick={() => handleDismiss(activeInterview.id)}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--danger)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] hover:bg-[var(--danger-muted)] transition-all"
            >
              Not a Task
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 mb-6">
          <h2 className="text-[15px] font-semibold">{activeInterview.extracted_title}</h2>
          {activeInterview.suggested_interviewer && (
            <p className="mt-1 text-[11px] text-[var(--accent)]">
              Suggested interviewer: {activeInterview.suggested_interviewer.name}
            </p>
          )}
          <p className="mt-2 text-[13px] text-[var(--foreground-secondary)] leading-relaxed">
            {activeInterview.extracted_description}
          </p>

          {activeInterview.source_quotes?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)] mb-2">
                Source Quotes
              </h3>
              {activeInterview.source_quotes.map((q, i) => (
                <blockquote
                  key={i}
                  className="border-l-2 border-[var(--accent)] pl-3 py-1 my-2 text-[13px] italic text-[var(--foreground-secondary)]"
                >
                  {q.speaker && (
                    <span className="not-italic font-medium text-[var(--foreground)]">{q.speaker}: </span>
                  )}
                  &ldquo;{q.text}&rdquo;
                </blockquote>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">
            Clarifying Questions
          </h3>
          {activeInterview.missing_context?.length > 0 ? (
            activeInterview.missing_context.map((question, i) => (
              <div key={i}>
                <label className="block text-[13px] font-medium mb-1.5">
                  {question}
                </label>
                <textarea
                  className="w-full rounded-xl"
                  rows={2}
                  value={responses[question] || ""}
                  onChange={(e) =>
                    setResponses((prev) => ({
                      ...prev,
                      [question]: e.target.value,
                    }))
                  }
                  placeholder="Your answer..."
                />
              </div>
            ))
          ) : (
            <p className="text-[13px] text-[var(--foreground-tertiary)]">
              No clarifying questions needed.
            </p>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleComplete}
            disabled={submitting}
            className="rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-5 py-2 text-[13px] font-semibold transition-all disabled:opacity-40"
          >
            {submitting ? "Creating..." : "Create Task"}
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg border border-[var(--border)] px-5 py-2 text-[13px] font-medium text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] transition-all"
          >
            Save Progress
          </button>
        </div>
      </div>
    );
  }

  // ─── Queue List ───────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Interview Queue</h1>
          <p className="text-[13px] text-[var(--foreground-secondary)] mt-1">
            Tasks requiring human input before repo analysis, approval, or Jira creation
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] border border-[var(--border)] px-3 py-1 text-[12px] font-medium text-[var(--foreground-secondary)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse-dot" />
          {interviews.length} pending
        </span>
      </div>

      {interviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-16 text-center">
          <svg className="w-8 h-8 mx-auto text-[var(--foreground-tertiary)] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
          </svg>
          <p className="text-[13px] text-[var(--foreground-tertiary)]">No interviews pending.</p>
          <p className="text-[12px] text-[var(--foreground-tertiary)] mt-1">
            Tasks from new meetings will appear here when they need human input.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {interviews.map((task) => (
            <div
              key={task.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--border-accent)] transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-medium truncate">
                      {task.extracted_title}
                    </h3>
                    {task.status === "claimed" && (
                      <span className="text-[10px] bg-[var(--warning-muted)] text-[var(--warning)] rounded px-1.5 py-0.5 font-medium">
                        Claimed
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--foreground-tertiary)]">
                    {task.transcript && (
                      <>
                        <span>{task.transcript.meeting_title}</span>
                        <span className="tabular-nums">
                          {new Date(task.transcript.meeting_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex gap-1.5 items-center flex-wrap">
                    <ConfidenceDot confidence={task.confidence} />
                    <PriorityDot priority={task.priority} />
                    <span className="text-[10px] text-[var(--foreground-tertiary)] ml-1">
                      {task.missing_context?.length || 0} questions
                    </span>
                    {task.suggested_interviewer && (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--accent-muted)] text-[var(--accent)]">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        {task.suggested_interviewer.name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => startAIChat(task)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold hover:brightness-110 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Chat
                  </button>
                  <button
                    onClick={() => handleClaim(task.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] text-[var(--foreground-secondary)] px-3 py-1.5 text-[11px] font-medium hover:bg-[var(--surface-hover)] transition-all"
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => handleDismiss(task.id)}
                    className="inline-flex items-center rounded-lg border border-[var(--border)] text-[var(--foreground-tertiary)] px-2 py-1.5 text-[11px] hover:text-[var(--danger)] hover:border-[color-mix(in_srgb,var(--danger)_30%,transparent)] transition-all"
                    title="Dismiss"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared Badges ────────────────────────────────────────────────────────

function ConfidenceDot({ confidence }: { confidence: string }) {
  const config: Record<string, { color: string; bg: string }> = {
    high: { color: "var(--success)", bg: "var(--success-muted)" },
    medium: { color: "var(--warning)", bg: "var(--warning-muted)" },
    low: { color: "var(--danger)", bg: "var(--danger-muted)" },
  };
  const c = config[confidence] || config.low;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: c.bg, color: c.color }}
    >
      <span className="w-1 h-1 rounded-full" style={{ backgroundColor: c.color }} />
      {confidence}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const config: Record<string, { color: string; bg: string }> = {
    P0: { color: "var(--danger)", bg: "var(--danger-muted)" },
    P1: { color: "var(--warning)", bg: "var(--warning-muted)" },
    P2: { color: "var(--info)", bg: "var(--info-muted)" },
    P3: { color: "var(--foreground-tertiary)", bg: "var(--surface-active)" },
  };
  const c = config[priority] || config.P3;
  return (
    <span
      className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded"
      style={{ backgroundColor: c.bg, color: c.color }}
    >
      {priority}
    </span>
  );
}

// ─── Voice Interview Component ─────────────────────────────────────────────

function VoiceInterviewView({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const realtime = useRealtimeInterview(task.id);

  useEffect(() => {
    realtime.connect();
    return () => realtime.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [realtime.transcript]);

  const handleEnd = () => {
    realtime.disconnect();
    onClose();
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col animate-fade-in" style={{ height: "calc(100vh - 8rem)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Voice Interview</h1>
          <p className="text-[13px] text-[var(--foreground-secondary)]">{task.extracted_title}</p>
        </div>
        <button
          onClick={handleEnd}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium border border-[var(--border)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] transition-all"
        >
          End
        </button>
      </div>

      {/* Task context */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-4">
        <div className="flex gap-2 flex-wrap items-center">
          <ConfidenceDot confidence={task.confidence} />
          <PriorityDot priority={task.priority} />
          {task.transcript && (
            <span className="text-[11px] text-[var(--foreground-tertiary)]">
              from {task.transcript.meeting_title}
            </span>
          )}
          {task.suggested_interviewer && (
            <span className="text-[11px] text-[var(--accent)]">
              suggested: {task.suggested_interviewer.name}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[13px] text-[var(--foreground-secondary)] leading-relaxed">
          {task.extracted_description}
        </p>
      </div>

      {/* Voice visualizer */}
      <VoiceVisualizer
        status={realtime.status}
        speakerState={realtime.speakerState}
        audioLevel={realtime.audioLevel}
        error={realtime.error}
        onRetry={realtime.connect}
      />

      {/* Live transcript */}
      <div className="flex-1 overflow-y-auto mt-4 space-y-3 min-h-0">
        {realtime.transcript.length === 0 && realtime.status === "connected" && (
          <p className="text-center text-[13px] text-[var(--foreground-tertiary)] py-4">
            Waiting for the conversation to begin...
          </p>
        )}

        {realtime.transcript.map((entry, i) => (
          <TranscriptBubble key={i} entry={entry} />
        ))}

        {realtime.completion && <CompletionBanner completion={realtime.completion} />}
        <div ref={scrollRef} />
      </div>

      {realtime.completion && (
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-4 py-2.5 text-[13px] font-semibold transition-all"
        >
          Back to Queue
        </button>
      )}
    </div>
  );
}

// ─── Voice Visualizer ──────────────────────────────────────────────────────

function VoiceVisualizer({
  status,
  speakerState,
  audioLevel,
  error,
  onRetry,
}: {
  status: ConnectionStatus;
  speakerState: SpeakerState;
  audioLevel: number;
  error: string | null;
  onRetry: () => void;
}) {
  const scale = 1 + audioLevel * 0.6;

  const ringColor =
    status === "connecting" ? "var(--warning)"
    : status === "error" ? "var(--danger)"
    : speakerState === "user-speaking" ? "var(--accent)"
    : speakerState === "model-speaking" ? "var(--purple)"
    : "var(--border)";

  const statusLabel =
    status === "connecting" ? "Connecting..."
    : status === "error" ? (error || "Connection error")
    : speakerState === "user-speaking" ? "Listening..."
    : speakerState === "model-speaking" ? "Speaking..."
    : status === "connected" ? "Ready"
    : "Disconnected";

  return (
    <div className="flex flex-col items-center py-6">
      <div
        className="relative w-24 h-24 rounded-full flex items-center justify-center"
        style={{
          border: `3px solid ${ringColor}`,
          backgroundColor: `color-mix(in srgb, ${ringColor} 8%, transparent)`,
          transform: `scale(${scale})`,
          transition: "transform 0.1s ease-out, border-color 0.3s, background-color 0.3s",
        }}
      >
        {(speakerState === "user-speaking" || speakerState === "model-speaking") && (
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-20"
            style={{ border: `2px solid ${ringColor}` }}
          />
        )}

        {status === "connecting" && (
          <svg className="w-8 h-8 animate-spin" style={{ color: ringColor }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}

        {status === "connected" && speakerState !== "model-speaking" && (
          <svg className="w-8 h-8" style={{ color: ringColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" />
          </svg>
        )}

        {status === "connected" && speakerState === "model-speaking" && (
          <svg className="w-8 h-8" style={{ color: ringColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        )}

        {status === "error" && (
          <svg className="w-8 h-8" style={{ color: ringColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>

      <p className="mt-3 text-[12px] font-medium text-[var(--foreground-tertiary)]">
        {statusLabel}
      </p>

      {status === "error" && (
        <button onClick={onRetry} className="mt-1.5 text-[12px] text-[var(--accent)] hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

// ─── Transcript Bubble ─────────────────────────────────────────────────────

function TranscriptBubble({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"} animate-slide-in`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
          entry.role === "user"
            ? "bg-[var(--accent)] text-white"
            : "bg-[var(--surface)] border border-[var(--border)]"
        }`}
      >
        {entry.role === "assistant" && (
          <p className="text-[10px] font-semibold text-[var(--purple)] mb-1.5 uppercase tracking-wider">
            AI Interviewer
          </p>
        )}
        <p className="whitespace-pre-wrap">{entry.text}</p>
      </div>
    </div>
  );
}

// ─── Completion Banner ─────────────────────────────────────────────────────

function CompletionBanner({ completion }: { completion: VoiceCompletion }) {
  return (
    <div
      className={`rounded-xl border p-4 text-[13px] animate-fade-in ${
        completion.should_create
          ? "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-muted)]"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      {completion.should_create ? (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <p className="font-semibold text-[var(--success)]">Interview complete</p>
          </div>
          <p className="text-[var(--foreground-secondary)] ml-6">
            <span className="font-medium text-[var(--foreground)]">{completion.title}</span>
            {" "}&middot;{" "}{completion.priority}
            {completion.assignee && <> &rarr; {completion.assignee}</>}
          </p>
        </div>
      ) : (
        <p className="font-medium text-[var(--foreground-tertiary)]">
          Task dismissed &mdash; {completion.description}
        </p>
      )}
    </div>
  );
}
