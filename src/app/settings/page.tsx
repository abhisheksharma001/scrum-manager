"use client";

import { useState, useEffect } from "react";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-[13px] text-[var(--foreground-secondary)]">
          Configure how the pipeline routes and processes tasks.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold">Confidence Thresholds</h2>
          <p className="text-[12px] text-[var(--foreground-tertiary)] mt-0.5">
            Control which tasks skip the interview queue
          </p>
        </div>
        <div className="px-5 py-5">
          <ConfidenceThresholdControl />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold">Project Routing</h2>
          <p className="text-[12px] text-[var(--foreground-tertiary)] mt-0.5">
            Define target projects and let AI route tasks automatically
          </p>
        </div>
        <div className="px-5 py-5">
          <ProjectRoutes />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold">Scrum Relief</h2>
          <p className="text-[12px] text-[var(--foreground-tertiary)] mt-0.5">
            Configure repo-aware developer briefs
          </p>
        </div>
        <div className="px-5 py-5">
          <ScrumReliefSettings />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold">Local Learning</h2>
          <p className="text-[12px] text-[var(--foreground-tertiary)] mt-0.5">
            Index local repos and manage PM-taught routing memories
          </p>
        </div>
        <div className="px-5 py-5">
          <LocalLearningSettings />
        </div>
      </div>
    </div>
  );
}

// ─── Confidence Threshold Control ──────────────────────────────────────────

function ConfidenceThresholdControl() {
  const [threshold, setThreshold] = useState<string[]>(["high"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const val = data.config?.confidence_auto_create_threshold;
        if (Array.isArray(val)) setThreshold(val);
        else if (typeof val === "string") {
          try { setThreshold(JSON.parse(val)); } catch { /* keep default */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (level: string) => {
    const next = threshold.includes(level)
      ? threshold.filter((l) => l !== level)
      : [...threshold, level];
    setThreshold(next);
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/config/confidence_auto_create_threshold", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* swallow */ }
    finally { setSaving(false); }
  };

  const levels = [
    {
      id: "high",
      label: "High",
      description: "Clear owner, specific deliverable, timeline mentioned",
      color: "var(--success)",
    },
    {
      id: "medium",
      label: "Medium",
      description: "Action discussed but owner or scope is ambiguous",
      color: "var(--warning)",
    },
    {
      id: "low",
      label: "Low",
      description: "Vague reference to future work, no clear owner",
      color: "var(--danger)",
    },
  ];

  if (loading) {
    return <div className="h-40 skeleton rounded-lg" />;
  }

  const interviewLevels = levels.filter((l) => !threshold.includes(l.id));
  const autoLevels = levels.filter((l) => threshold.includes(l.id));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-[var(--foreground-secondary)]">
        Choose which confidence levels skip the human interview and get sent
        straight to your issue tracker. Everything else goes to the interview queue for review.
      </p>

      <div className="flex flex-col gap-2">
        {levels.map((level) => {
          const active = threshold.includes(level.id);
          return (
            <button
              key={level.id}
              onClick={() => toggle(level.id)}
              disabled={saving}
              className={`flex items-center gap-4 rounded-xl border px-4 py-3 text-left transition-all ${
                active
                  ? "border-[var(--border-accent)] bg-[var(--accent-glow)]"
                  : "border-[var(--border)] bg-[var(--background-secondary)] hover:border-[var(--foreground-tertiary)]"
              }`}
            >
              <div
                className={`flex shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)]"
                    : "border-[var(--foreground-tertiary)]"
                }`}
                style={{ width: 18, height: 18 }}
              >
                {active && (
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div className="flex flex-1 items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: level.color }} />
                    <span className="text-[13px] font-medium">{level.label} confidence</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--foreground-tertiary)]">{level.description}</p>
                </div>
                <span
                  className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    backgroundColor: active ? "var(--accent-muted)" : "var(--warning-muted)",
                    color: active ? "var(--accent)" : "var(--warning)",
                  }}
                >
                  {active ? "Auto-create" : "Interview"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {saved && (
        <p className="text-[11px] text-[var(--success)] animate-fade-in">
          Saved — changes apply to the next transcript processed.
        </p>
      )}

      <div className="rounded-lg bg-[var(--background-secondary)] border border-[var(--border-subtle)] p-3 text-[13px] text-[var(--foreground-secondary)]">
        <strong className="text-[var(--foreground)]">Current behavior:</strong>{" "}
        {autoLevels.length === 0 ? (
          <>All tasks go through the interview queue before being created.</>
        ) : autoLevels.length === 3 ? (
          <>All tasks are auto-created. The interview queue is bypassed entirely.</>
        ) : (
          <>
            <strong>{autoLevels.map((l) => l.label.toLowerCase()).join(" and ")}</strong>{" "}
            confidence tasks are auto-created.{" "}
            <strong>{interviewLevels.map((l) => l.label.toLowerCase()).join(" and ")}</strong>{" "}
            confidence tasks go through the interview queue.
          </>
        )}
      </div>
    </div>
  );
}

// ─── Scrum Relief Settings ────────────────────────────────────────────────

interface ProjectRepo {
  owner_user_id?: string | null;
  project_key: string;
  repo_full_name: string;
  is_primary?: boolean;
  paths_hint?: string | null;
}

// ─── Local Learning Settings ──────────────────────────────────────────────

interface RepoCatalogEntry {
  id: string;
  repo_name: string;
  local_path: string;
  project_key: string | null;
  description: string | null;
  important_paths: string[];
  indexed_at: string;
}

interface LearningMemory {
  id: string;
  status: "active" | "pending" | "inactive";
  memory_type: string;
  pattern: string;
  target: Record<string, unknown>;
  confidence: number;
  evidence_count: number;
}

function LocalLearningSettings() {
  const [localPath, setLocalPath] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [repoName, setRepoName] = useState("");
  const [repos, setRepos] = useState<RepoCatalogEntry[]>([]);
  const [memories, setMemories] = useState<LearningMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [repoRes, memoryRes] = await Promise.all([
      fetch("/api/repo-catalog/index"),
      fetch("/api/learning/memories"),
    ]);
    const [repoData, memoryData] = await Promise.all([repoRes.json(), memoryRes.json()]);
    setRepos(repoData.repos || []);
    setMemories(memoryData.memories || []);
  };

  useEffect(() => {
    load().catch(() => {}).finally(() => setLoading(false));
  }, []);

  const indexRepo = async () => {
    setIndexing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/repo-catalog/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localPath,
          projectKey: projectKey.trim() || null,
          repoName: repoName.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not index repo");
      setLocalPath("");
      setRepoName("");
      setMessage("Repo indexed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Indexing failed");
    } finally {
      setIndexing(false);
    }
  };

  const updateMemory = async (id: string, status: LearningMemory["status"]) => {
    await fetch(`/api/learning/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  };

  if (loading) return <div className="h-40 skeleton rounded-lg" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 md:grid-cols-[1fr_100px_160px_auto]">
          <input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/Users/name/projects/shiro" className="font-mono" />
          <input value={projectKey} onChange={(e) => setProjectKey(e.target.value.toUpperCase())} placeholder="ENG" className="font-mono" />
          <input value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="Display name" />
          <button
            onClick={indexRepo}
            disabled={indexing || !localPath.trim()}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            {indexing ? "Indexing..." : "Index Repo"}
          </button>
        </div>
        {message && <p className="text-[11px] text-[var(--foreground-tertiary)]">{message}</p>}

        <div className="flex flex-col gap-2">
          {repos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-[12px] text-[var(--foreground-tertiary)]">
              No local repos indexed yet.
            </p>
          ) : repos.map((repo) => (
            <div key={repo.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold">{repo.repo_name}</p>
                  <p className="mt-0.5 text-[11px] font-mono text-[var(--foreground-tertiary)]">{repo.local_path}</p>
                </div>
                {repo.project_key && <span className="rounded bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-mono text-[var(--accent)]">{repo.project_key}</span>}
              </div>
              {repo.description && <p className="mt-2 text-[12px] text-[var(--foreground-secondary)] line-clamp-2">{repo.description}</p>}
              <p className="mt-2 text-[10px] text-[var(--foreground-tertiary)]">
                {repo.important_paths?.length ?? 0} important paths · indexed {new Date(repo.indexed_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] pt-5">
        <h3 className="text-[13px] font-semibold">Memories</h3>
        <div className="mt-3 flex flex-col gap-2">
          {memories.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-[12px] text-[var(--foreground-tertiary)]">
              No PM teaching memories yet.
            </p>
          ) : memories.map((memory) => (
            <div key={memory.id} className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase text-[var(--foreground-tertiary)]">{memory.memory_type.replaceAll("_", " ")}</span>
                    <span className="rounded bg-[var(--surface-active)] px-2 py-0.5 text-[10px]">{memory.status}</span>
                    <span className="text-[10px] text-[var(--foreground-tertiary)]">{Math.round(memory.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1 text-[13px] text-[var(--foreground-secondary)]">{memory.pattern}</p>
                  <p className="mt-1 text-[10px] font-mono text-[var(--foreground-tertiary)]">{JSON.stringify(memory.target)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {memory.status !== "active" && (
                    <button onClick={() => updateMemory(memory.id, "active")} className="rounded border border-[var(--border)] px-2 py-1 text-[10px]">Activate</button>
                  )}
                  {memory.status !== "inactive" && (
                    <button onClick={() => updateMemory(memory.id, "inactive")} className="rounded border border-[var(--border)] px-2 py-1 text-[10px]">Disable</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScrumReliefSettings() {
  const [approvalMode, setApprovalMode] = useState("gate");
  const [minConfidence, setMinConfidence] = useState("high");
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/project-repos").then((r) => r.json()),
    ])
      .then(([configData, repoData]) => {
        const mode = configData.config?.brief_approval_mode;
        const confidence = configData.config?.auto_send_min_confidence;
        if (typeof mode === "string") setApprovalMode(mode);
        if (typeof confidence === "string") setMinConfidence(confidence);
        setRepos(repoData.repos || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const persistConfig = async (key: string, value: string) => {
    await fetch(`/api/config/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  };

  const persistRepos = async (next: ProjectRepo[]) => {
    await fetch("/api/project-repos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos: next }),
    });
  };

  const saveAll = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        persistConfig("brief_approval_mode", approvalMode),
        persistConfig("auto_send_min_confidence", minConfidence),
        persistRepos(repos),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const addRepo = () => {
    setRepos([...repos, { project_key: "ENG", repo_full_name: "", is_primary: repos.length === 0, paths_hint: "" }]);
  };

  const updateRepo = (idx: number, patch: Partial<ProjectRepo>) => {
    setRepos(repos.map((repo, i) => (i === idx ? { ...repo, ...patch } : repo)));
  };

  const removeRepo = (idx: number) => {
    setRepos(repos.filter((_, i) => i !== idx));
  };

  if (loading) {
    return <div className="h-40 skeleton rounded-lg" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Approval Mode</span>
          <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value)} className="w-full">
            <option value="gate">Gate: PM approves analysis and delivery</option>
            <option value="confidence">Confidence: high confidence can auto-send</option>
            <option value="auto">Auto: send every generated brief</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-tertiary)]">Auto-send threshold</span>
          <select value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} className="w-full">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          Map tracker projects to GitHub repositories the brief agent may read.
        </p>
        <button
          onClick={addRepo}
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)]"
        >
          Add Repo
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {repos.map((repo, idx) => (
          <div key={idx} className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] p-3 md:grid-cols-[90px_1fr_1fr_auto_auto]">
            <input
              value={repo.project_key}
              onChange={(e) => updateRepo(idx, { project_key: e.target.value.toUpperCase() })}
              placeholder="ENG"
              className="font-mono"
            />
            <input
              value={repo.repo_full_name}
              onChange={(e) => updateRepo(idx, { repo_full_name: e.target.value })}
              placeholder="org/repo"
              className="font-mono"
            />
            <input
              value={repo.paths_hint || ""}
              onChange={(e) => updateRepo(idx, { paths_hint: e.target.value })}
              placeholder="src/lib"
              className="font-mono"
            />
            <label className="flex items-center gap-2 text-[12px] text-[var(--foreground-secondary)]">
              <input
                type="checkbox"
                checked={Boolean(repo.is_primary)}
                onChange={(e) => updateRepo(idx, { is_primary: e.target.checked })}
              />
              Primary
            </label>
            <button
              onClick={() => removeRepo(idx)}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-[var(--danger-muted)]"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={saveAll}
          disabled={saving}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save Scrum Relief"}
        </button>
        {saved && <span className="text-[11px] text-[var(--success)]">Saved.</span>}
      </div>
    </div>
  );
}

// ─── Project Routes ──────────────────────────────────────────────────────

interface ProjectRoute {
  projectKey: string;
  name: string;
  routingPrompt: string;
  isDefault?: boolean;
}

function ProjectRoutes() {
  const [routes, setRoutes] = useState<ProjectRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const val = data.config?.project_routes;
        if (Array.isArray(val)) setRoutes(val);
        else if (typeof val === "string") {
          try { setRoutes(JSON.parse(val)); } catch { /* keep default */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const persist = async (next: ProjectRoute[]) => {
    setRoutes(next);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/config/project_routes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to save routes:", err);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { console.error("Failed to save routes:", err); }
    finally { setSaving(false); }
  };

  const addRoute = () => {
    const next = [...routes, { projectKey: "", name: "", routingPrompt: "", isDefault: routes.length === 0 }];
    setRoutes(next);
    setEditingIdx(next.length - 1);
  };

  const removeRoute = (idx: number) => {
    const removed = routes[idx];
    let next = routes.filter((_, i) => i !== idx);
    if (removed.isDefault && next.length > 0) {
      next = next.map((r, i) => i === 0 ? { ...r, isDefault: true } : r);
    }
    setEditingIdx(null);
    persist(next);
  };

  const updateRoute = (idx: number, patch: Partial<ProjectRoute>) => {
    const next = routes.map((r, i) => i === idx ? { ...r, ...patch } : r);
    setRoutes(next);
  };

  const setDefault = (idx: number) => {
    const next = routes.map((r, i) => ({ ...r, isDefault: i === idx }));
    persist(next);
  };

  const saveRoute = (idx: number) => {
    const route = routes[idx];
    if (!route.projectKey.trim() || !route.name.trim()) return;
    setEditingIdx(null);
    persist(routes);
  };

  if (loading) {
    return <div className="h-32 skeleton rounded-lg" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[var(--foreground-secondary)]">
          Define target projects. AI routes tasks to the best match based on content.
        </p>
        <button
          onClick={addRoute}
          disabled={saving}
          className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--accent-hover)] transition-all disabled:opacity-40"
        >
          Add Project
        </button>
      </div>

      {routes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-[13px] text-[var(--foreground-tertiary)]">
            No project routes configured. Tasks will use the default project from your environment config.
          </p>
          <button onClick={addRoute} className="mt-2 text-[12px] text-[var(--accent)] hover:underline">
            Add your first project
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {routes.map((route, idx) => (
            <div
              key={idx}
              className={`rounded-xl border px-4 py-3 transition-all ${
                route.isDefault
                  ? "border-[var(--border-accent)] bg-[var(--accent-glow)]"
                  : "border-[var(--border)] bg-[var(--background-secondary)]"
              }`}
            >
              {editingIdx === idx ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-[var(--foreground-tertiary)] uppercase tracking-wider">Project Key</label>
                      <input
                        type="text"
                        value={route.projectKey}
                        onChange={(e) => updateRoute(idx, { projectKey: e.target.value.toUpperCase() })}
                        placeholder="ENG"
                        className="mt-1 w-full font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[var(--foreground-tertiary)] uppercase tracking-wider">Display Name</label>
                      <input
                        type="text"
                        value={route.name}
                        onChange={(e) => updateRoute(idx, { name: e.target.value })}
                        placeholder="Engineering"
                        className="mt-1 w-full"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--foreground-tertiary)] uppercase tracking-wider">Routing Prompt</label>
                    <textarea
                      value={route.routingPrompt}
                      onChange={(e) => updateRoute(idx, { routingPrompt: e.target.value })}
                      placeholder="Describe what kinds of tasks belong in this project..."
                      rows={2}
                      className="mt-1 w-full resize-y rounded-xl"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        if (!route.projectKey && !route.name) removeRoute(idx);
                        else setEditingIdx(null);
                      }}
                      className="rounded-lg px-3 py-1 text-[11px] font-medium border border-[var(--border)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveRoute(idx)}
                      disabled={!route.projectKey.trim() || !route.name.trim()}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[var(--accent-hover)] transition-all disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-mono font-semibold text-[var(--accent)]">{route.projectKey}</span>
                      <span className="text-[13px] text-[var(--foreground-secondary)]">{route.name}</span>
                      {route.isDefault && (
                        <span className="rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[9px] font-semibold text-[var(--accent)] uppercase tracking-wider">
                          Default
                        </span>
                      )}
                    </div>
                    {route.routingPrompt && (
                      <p className="mt-1 text-[11px] text-[var(--foreground-tertiary)] line-clamp-2">{route.routingPrompt}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!route.isDefault && (
                      <button
                        onClick={() => setDefault(idx)}
                        className="rounded-md px-2 py-1 text-[10px] font-medium text-[var(--foreground-tertiary)] hover:text-[var(--accent)] border border-[var(--border)] hover:border-[var(--border-accent)] transition-all"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      onClick={() => setEditingIdx(idx)}
                      className="rounded-md px-2 py-1 text-[11px] text-[var(--foreground-tertiary)] hover:text-[var(--foreground)] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeRoute(idx)}
                      disabled={routes.length === 1}
                      className="rounded-md px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-[var(--danger-muted)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {saved && (
        <p className="text-[11px] text-[var(--success)] animate-fade-in">
          Saved — routing changes apply to the next task processed.
        </p>
      )}

      {routes.length > 1 && (
        <div className="rounded-lg bg-[var(--background-secondary)] border border-[var(--border-subtle)] p-3 text-[13px] text-[var(--foreground-secondary)]">
          <strong className="text-[var(--foreground)]">How routing works:</strong>{" "}
          Claude reads each project&apos;s routing prompt and the task&apos;s
          title, description, and labels to pick the best match. If no strong match is found,
          the task goes to the default project.
        </div>
      )}
    </div>
  );
}
