import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase";

interface ProjectRepoPayload {
  project_key: string;
  repo_full_name: string;
  is_primary?: boolean;
  paths_hint?: string | null;
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const { data, error } = await supabaseAdmin
      .from("project_repos")
      .select("*")
      .order("project_key")
      .order("is_primary", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ repos: data ?? [] });
  } catch (err) {
    return apiError(err, { route: "project-repos" });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAuth(request);
    const body = (await request.json()) as { repos?: ProjectRepoPayload[] };
    const repos = body.repos ?? [];

    const normalized = repos
      .filter((r) => r.project_key?.trim() && r.repo_full_name?.trim())
      .map((r) => ({
        project_key: r.project_key.trim().toUpperCase(),
        repo_full_name: r.repo_full_name.trim(),
        is_primary: Boolean(r.is_primary),
        paths_hint: r.paths_hint?.trim() || null,
      }));

    const { error: deleteError } = await supabaseAdmin
      .from("project_repos")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (deleteError) throw deleteError;

    if (normalized.length > 0) {
      const { error } = await supabaseAdmin.from("project_repos").insert(normalized);
      if (error) throw error;
    }

    return NextResponse.json({ repos: normalized });
  } catch (err) {
    return apiError(err, { route: "project-repos" });
  }
}
