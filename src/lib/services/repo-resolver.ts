import { supabaseAdmin } from "@/lib/supabase";
import { learningStore } from "@/lib/learning/store";
import type { ExtractedTaskRow } from "@/lib/types";

export interface ResolvedRepo {
  repo: string;
  isPrimary: boolean;
  pathsHint: string | null;
}

export async function resolveReposForProject(
  projectKey: string | null | undefined,
  ownerUserId?: string | null
): Promise<ResolvedRepo[]> {
  if (!projectKey) return [];
  const { data, error } = await supabaseAdmin
    .from("project_repos")
    .select("*")
    .eq("project_key", projectKey);
  if (error || !data) return [];
  return data
    .filter((row) => !ownerUserId || !row.owner_user_id || row.owner_user_id === ownerUserId)
    .map((row) => ({
      repo: row.repo_full_name as string,
      isPrimary: Boolean(row.is_primary),
      pathsHint: (row.paths_hint as string | null) ?? null,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

export async function resolveReposForTask(task: ExtractedTaskRow): Promise<ResolvedRepo[]> {
  const decision = await learningStore.getLatestRoutingDecision(task.id);
  const decisionRepos = decision?.repo_matches ?? [];
  if (decisionRepos.length > 0) {
    return decisionRepos.map((repo, index) => ({
      repo: repo.repo,
      isPrimary: index === 0,
      pathsHint: repo.reason ?? null,
    }));
  }

  const ownerUserId = await learningStore.findTaskOwner(task);
  return resolveReposForProject(task.tracker_project, ownerUserId);
}
