import { supabaseAdmin } from "@/lib/supabase";

export interface ResolvedRepo {
  repo: string;
  isPrimary: boolean;
  pathsHint: string | null;
}

export async function resolveReposForProject(
  projectKey: string | null | undefined
): Promise<ResolvedRepo[]> {
  if (!projectKey) return [];
  const { data, error } = await supabaseAdmin
    .from("project_repos")
    .select("*")
    .eq("project_key", projectKey);
  if (error || !data) return [];
  return data
    .map((row) => ({
      repo: row.repo_full_name as string,
      isPrimary: Boolean(row.is_primary),
      pathsHint: (row.paths_hint as string | null) ?? null,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}
