import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { buildTaskSearchText, isMeaningfullyAhead, textScore } from "./matching";
import { learningStore } from "./store";
import { matchReposForTask } from "./local-repo-reader";
import type { ExtractedTaskRow, LearningMemoryRow, RoutingDecisionRow } from "@/lib/types";

export interface LearningRoutingPreview {
  projectKey: string | null;
  repoMatches: RoutingDecisionRow["repo_matches"];
  assignee: string | null;
  pathMatches: RoutingDecisionRow["path_matches"];
  confidence: number;
  source: RoutingDecisionRow["source"];
  explanation: string;
  alternatives: RoutingDecisionRow["alternatives"];
  needsReview: boolean;
  ownerUserId: string | null;
}

export async function previewLearningRouting(
  task: ExtractedTaskRow,
  options: { persist?: boolean; fallbackProjectKey?: string | null } = {}
): Promise<LearningRoutingPreview> {
  const ownerUserId = await learningStore.findTaskOwner(task);
  if (!ownerUserId) {
    return {
      projectKey: options.fallbackProjectKey ?? task.tracker_project ?? null,
      repoMatches: [],
      assignee: task.inferred_assignees?.[0]?.name ?? null,
      pathMatches: [],
      confidence: 0.2,
      source: "fallback",
      explanation: "No local owner was available, so learning memory was skipped.",
      alternatives: [],
      needsReview: true,
      ownerUserId: null,
    };
  }

  const memories = await learningStore.listMemories(ownerUserId, "active");
  const taskText = buildTaskSearchText({
    title: task.extracted_title,
    description: task.extracted_description,
    labels: task.labels,
    missingContext: task.missing_context,
  });
  const memoryDecision = decisionFromMemories(taskText, memories);
  const catalogMatches = await matchReposForTask(ownerUserId, task);
  const projectMappings = await getProjectRepoMappings(ownerUserId, memoryDecision.projectKey ?? task.tracker_project);

  const repoMatches = selectRepoMatches(memoryDecision.repoMatches, projectMappings, catalogMatches);
  const pathMatches = memoryDecision.pathMatches;
  const projectKey = memoryDecision.projectKey ?? task.tracker_project ?? options.fallbackProjectKey ?? null;
  const assignee = memoryDecision.assignee ?? task.inferred_assignees?.[0]?.name ?? null;
  const bestCatalog = catalogMatches[0]?.score ?? 0;
  const secondCatalog = catalogMatches[1]?.score ?? 0;
  const catalogUnclear = catalogMatches.length > 1 && !isMeaningfullyAhead(bestCatalog, secondCatalog);
  const confidence = Math.max(memoryDecision.confidence, bestCatalog, projectKey ? 0.55 : 0.25);
  const source = memoryDecision.source ?? (projectMappings.length > 0 ? "project_mapping" : bestCatalog >= 0.45 ? "repo_catalog" : "pm_review");
  const needsReview = confidence < 0.45 || catalogUnclear || !projectKey;
  const explanation = buildExplanation({
    memoryDecision,
    projectMappings: projectMappings.length,
    catalogMatches,
    projectKey,
    needsReview,
  });
  const alternatives = catalogMatches.slice(0, 5).map((match) => ({
    repo: match.repo,
    projectKey: match.projectKey,
    score: Number(match.score.toFixed(2)),
    reason: match.reason,
  }));

  const preview: LearningRoutingPreview = {
    projectKey,
    repoMatches,
    assignee,
    pathMatches,
    confidence: Number(confidence.toFixed(2)),
    source,
    explanation,
    alternatives,
    needsReview,
    ownerUserId,
  };

  if (options.persist) {
    await learningStore.recordRoutingDecision({
      ownerUserId,
      taskId: task.id,
      projectKey: preview.projectKey,
      repoMatches: preview.repoMatches,
      assignee: preview.assignee,
      pathMatches: preview.pathMatches,
      confidence: preview.confidence,
      source: preview.source,
      explanation: preview.explanation,
      alternatives: preview.alternatives,
      needsReview: preview.needsReview,
    });
  }

  return preview;
}

function decisionFromMemories(taskText: string, memories: LearningMemoryRow[]) {
  const scored = memories
    .map((memory) => ({
      memory,
      score: textScore(taskText, `${memory.pattern} ${JSON.stringify(memory.target)}`) * memory.confidence,
    }))
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score);

  const result: {
    projectKey: string | null;
    repoMatches: RoutingDecisionRow["repo_matches"];
    pathMatches: RoutingDecisionRow["path_matches"];
    assignee: string | null;
    confidence: number;
    source: RoutingDecisionRow["source"] | null;
    hits: Array<{ id: string; type: string; score: number }>;
  } = {
    projectKey: null,
    repoMatches: [],
    pathMatches: [],
    assignee: null,
    confidence: 0,
    source: null,
    hits: [],
  };

  for (const { memory, score } of scored.slice(0, 6)) {
    result.confidence = Math.max(result.confidence, score);
    result.source = "memory";
    result.hits.push({ id: memory.id, type: memory.memory_type, score: Number(score.toFixed(2)) });

    if (!result.projectKey && typeof memory.target.projectKey === "string") {
      result.projectKey = memory.target.projectKey;
    }
    if (!result.assignee && typeof memory.target.assignee === "string") {
      result.assignee = memory.target.assignee;
    }
    if (Array.isArray(memory.target.repos)) {
      result.repoMatches.push(
        ...memory.target.repos.map((repo) => ({
          repo: String(repo),
          score: Number(score.toFixed(2)),
          reason: `Matched learned memory: ${memory.pattern}`,
        }))
      );
    }
    if (Array.isArray(memory.target.paths)) {
      result.pathMatches.push(
        ...memory.target.paths.map((path) => ({
          path: String(path),
          score: Number(score.toFixed(2)),
          reason: `Matched learned memory: ${memory.pattern}`,
        }))
      );
    }
  }

  return result;
}

async function getProjectRepoMappings(ownerUserId: string, projectKey: string | null | undefined) {
  if (!projectKey) return [];
  const { data } = await supabaseAdmin
    .from("project_repos")
    .select("*")
    .eq("project_key", projectKey);

  return (data ?? [])
    .filter((row) => !row.owner_user_id || row.owner_user_id === ownerUserId)
    .map((row) => ({
      repo: row.repo_full_name as string,
      score: row.is_primary ? 0.75 : 0.65,
      reason: `Mapped to tracker project ${projectKey}`,
    }));
}

function selectRepoMatches(
  memoryRepos: RoutingDecisionRow["repo_matches"],
  mappedRepos: Array<{ repo: string; score: number; reason: string }>,
  catalogMatches: Array<{ repo: string; localPath: string; score: number; reason: string }>
) {
  const seen = new Set<string>();
  const combined = [
    ...memoryRepos,
    ...mappedRepos,
    ...catalogMatches.slice(0, 3).map((match) => ({
      repo: match.repo,
      localPath: match.localPath,
      score: match.score,
      reason: match.reason,
    })),
  ];

  return combined.filter((repo) => {
    if (seen.has(repo.repo)) return false;
    seen.add(repo.repo);
    return true;
  }).slice(0, 5);
}

function buildExplanation(input: {
  memoryDecision: ReturnType<typeof decisionFromMemories>;
  projectMappings: number;
  catalogMatches: Array<{ repo: string; score: number }>;
  projectKey: string | null;
  needsReview: boolean;
}) {
  if (input.memoryDecision.hits.length > 0) {
    return `Used ${input.memoryDecision.hits.length} active PM memory rule(s) and selected ${input.projectKey ?? "no project yet"}.`;
  }
  if (input.projectMappings > 0) {
    return `Used explicit project-to-repo mapping for ${input.projectKey}.`;
  }
  if ((input.catalogMatches[0]?.score ?? 0) >= 0.45) {
    return `Matched local repo catalog metadata for ${input.catalogMatches[0].repo}.`;
  }
  if (input.needsReview) {
    return "Routing confidence is low or ambiguous, so PM review is recommended.";
  }
  return `Used fallback project ${input.projectKey}.`;
}
