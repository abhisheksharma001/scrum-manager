import { generateSearchPlan } from "@/lib/agents/search-planner-agent";
import { generateRepoBrief } from "@/lib/agents/repo-brief-agent";
import { supabaseAdmin } from "@/lib/supabase";
import { getRepoReader } from "./github-reader";
import { resolveReposForTask } from "./repo-resolver";
import { getBrief, getBriefConfig, setBriefStatus } from "./developer-brief";
import { markTaskAwaitingApproval, updateTaskStatus } from "./task-readiness";
import type { DeveloperBriefOutput } from "@/lib/agents/schemas";

interface BriefBudget {
  maxQueries: number;
  maxFiles: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
  maxToolCalls: number;
}

const DEFAULT_BUDGET: BriefBudget = {
  maxQueries: 6,
  maxFiles: 8,
  maxBytesPerFile: 40000,
  maxTotalBytes: 200000,
  maxToolCalls: 25,
};

function mapAnalysisErrorCode(errorMessage: string): string {
  if (
    errorMessage.includes("GitHub API error 401") ||
    errorMessage.includes("GitHub API error 403") ||
    errorMessage.includes("Repo not allowlisted") ||
    errorMessage.includes("GITHUB_READONLY_TOKEN")
  ) {
    return "github_access_denied";
  }
  if (errorMessage.includes("No relevant files")) {
    return "no_relevant_files";
  }
  return "generation_failed";
}

export async function analyzeBrief(briefId: string) {
  try {
    const brief = await getBrief(briefId);
    await setBriefStatus(briefId, "analyzing", { attempt: (brief.attempt ?? 0) + 1 });

    const { data: task } = await supabaseAdmin
      .from("extracted_tasks")
      .select("*")
      .eq("id", brief.task_id)
      .single();
    if (!task) throw new Error("Task not found for brief");

    const repos = await resolveReposForTask(task);
    if (repos.length === 0) {
      await setBriefStatus(briefId, "needs_human_direction", {
        error_code: "no_repo_configured",
        missing_info: ["Map a repository for the selected tracker project."],
        repos: [],
      });
      await updateTaskStatus(task.id, "pending_interview", {
        approval_status: "not_ready",
        missing_context: [
          ...((task.missing_context as string[] | null) ?? []),
          "Which GitHub repository should be used for this task?",
        ],
      });
      return;
    }

    const budget = await getBriefConfig<BriefBudget>("brief_budget", DEFAULT_BUDGET);
    const reader = getRepoReader();

    const plan = await generateSearchPlan({
      title: task.extracted_title,
      description: task.extracted_description,
      labels: task.labels ?? [],
    });
    const queries = plan.queries.slice(0, budget.maxQueries);

    let toolCalls = 0;
    let bytesRead = 0;
    const hits = new Map<string, { path: string; score: number; reason: string }>();
    const primaryRepo = repos[0].repo;

    for (const q of queries) {
      if (toolCalls >= budget.maxToolCalls) break;
      toolCalls += 1;
      const results = await reader.searchCode(primaryRepo, q);
      for (const r of results) {
        const key = `${r.repository}:${r.path}`;
        const existing = hits.get(key);
        if (!existing || r.score > existing.score) {
          hits.set(key, { path: r.path, score: r.score, reason: `Matched query: ${q}` });
        }
      }
    }

    const candidateFiles = [...hits.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, budget.maxFiles);

    if (candidateFiles.length === 0) {
      await setBriefStatus(briefId, "needs_human_direction", {
        error_code: "no_relevant_files",
        missing_info: ["No relevant files were found. Provide more specific implementation context."],
        repos: repos.map((r) => r.repo),
      });
      await updateTaskStatus(task.id, "pending_interview", {
        approval_status: "not_ready",
        repo_confidence: 0,
        missing_context: [
          ...((task.missing_context as string[] | null) ?? []),
          "Which files or areas of the repo are relevant to this task?",
        ],
      });
      return;
    }

    const branchInfo = await reader.getDefaultBranch(primaryRepo);
    const readme = await reader.getReadme(primaryRepo, branchInfo.branch);
    toolCalls += 2;

    const fileContexts: Array<{ path: string; reason: string; content: string }> = [];
    for (const f of candidateFiles) {
      if (toolCalls >= budget.maxToolCalls || bytesRead >= budget.maxTotalBytes) break;
      toolCalls += 1;
      const content = await reader.getFileContent(primaryRepo, f.path, branchInfo.branch);
      const clipped = content.slice(0, budget.maxBytesPerFile);
      bytesRead += Buffer.byteLength(clipped, "utf8");
      fileContexts.push({ path: f.path, reason: f.reason, content: clipped });
    }

    let out: DeveloperBriefOutput;
    try {
      out = await generateRepoBrief({
        taskTitle: task.extracted_title,
        taskDescription: task.extracted_description,
        assignee: task.inferred_assignees?.[0]?.name ?? null,
        trackerKey: task.tracker_issue_key ?? null,
        trackerUrl: task.tracker_issue_key && process.env.JIRA_BASE_URL
          ? `${process.env.JIRA_BASE_URL}/browse/${task.tracker_issue_key}`
          : null,
        repos: repos.map((r) => r.repo),
        candidateFiles: fileContexts,
        readme,
      });
    } catch (error) {
      await setBriefStatus(briefId, "failed", {
        error_code: "generation_failed",
        error_detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const validPaths = new Set(fileContexts.map((f) => f.path));
    const missing = [...out.missing_info];
    const cleaned = out.files_likely_involved.filter((f) => {
      const ok = validPaths.has(f.path);
      if (!ok) missing.push(`Model cited unknown path: ${f.path}`);
      return ok;
    });
    const cleanedCodeGuidance = out.execution_pack.code_guidance.filter((item) => {
      if (!item.file) return true;
      const ok = validPaths.has(item.file);
      if (!ok) missing.push(`Model gave code guidance for unknown path: ${item.file}`);
      return ok;
    });
    const confidence = missing.length > 0 && out.confidence === "high" ? "medium" : out.confidence;
    const status = "awaiting_pm_review";

    await setBriefStatus(briefId, status, {
      repos: repos.map((r) => r.repo),
      analyzed_commit_sha: branchInfo.sha,
      candidate_files: candidateFiles,
      brief: {
        ...out,
        files_likely_involved: cleaned,
        execution_pack: {
          ...out.execution_pack,
          code_guidance: cleanedCodeGuidance,
        },
        confidence,
        missing_info: missing,
      },
      confidence,
      missing_info: missing,
      tool_calls: toolCalls,
      bytes_read: bytesRead,
      model: "claude-sonnet-4-20250514",
      error_code: null,
      error_detail: null,
    });
    await markTaskAwaitingApproval(task.id);
    await supabaseAdmin
      .from("extracted_tasks")
      .update({
        repo_confidence: confidence === "high" ? 0.9 : confidence === "medium" ? 0.65 : confidence === "low" ? 0.35 : 0,
        routing_confidence: repos[0]?.isPrimary ? 0.75 : 0.6,
      })
      .eq("id", task.id);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await setBriefStatus(briefId, "failed", {
      error_code: mapAnalysisErrorCode(errorMessage),
      error_detail: errorMessage,
    });
  }
}
