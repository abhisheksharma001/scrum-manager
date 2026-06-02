import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase";
import { buildTaskSearchText, textScore } from "./matching";
import type { ExtractedTaskRow, RepoCatalogEntryRow } from "@/lib/types";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
]);

const IMPORTANT_NAMES = [
  "package.json",
  "README.md",
  "readme.md",
  "pyproject.toml",
  "Cargo.toml",
  "pom.xml",
  "go.mod",
  "requirements.txt",
];

interface IndexRepoInput {
  ownerUserId: string;
  localPath: string;
  projectKey?: string | null;
  repoName?: string | null;
}

export async function indexLocalRepo(input: IndexRepoInput): Promise<RepoCatalogEntryRow> {
  const localPath = path.resolve(input.localPath);
  const info = await stat(localPath);
  if (!info.isDirectory()) throw new Error("Local repo path must be a directory");

  const repoName = input.repoName?.trim() || path.basename(localPath);
  const readme = await readFirstReadable(localPath, ["README.md", "readme.md", "Readme.md"]);
  const packageJson = await readPackageJson(localPath);
  const fileTree = await collectTree(localPath);
  const importantPaths = fileTree.filter((file) => {
    const base = path.basename(file);
    return IMPORTANT_NAMES.includes(base) || file.startsWith("src/") || file.startsWith("app/");
  }).slice(0, 200);

  const description = packageJson.description || firstParagraph(readme);
  const readmeTitle = firstHeading(readme);
  const searchText = [
    repoName,
    input.projectKey,
    description,
    readmeTitle,
    packageJson.name,
    packageJson.description,
    packageJson.keywords?.join(" "),
    importantPaths.join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  const { data, error } = await supabaseAdmin
    .from("repo_catalog_entries")
    .upsert(
      {
        owner_user_id: input.ownerUserId,
        repo_name: repoName,
        local_path: localPath,
        project_key: input.projectKey?.trim().toUpperCase() || null,
        description: description || null,
        readme_title: readmeTitle || null,
        package_metadata: packageJson,
        important_paths: importantPaths,
        file_tree: fileTree,
        search_text: searchText,
        indexed_at: new Date().toISOString(),
      },
      { onConflict: "owner_user_id,local_path" }
    )
    .select("*")
    .single();

  if (error || !data) throw error ?? new Error("Failed to index local repo");
  return data as RepoCatalogEntryRow;
}

export async function listRepoCatalog(ownerUserId: string): Promise<RepoCatalogEntryRow[]> {
  const { data, error } = await supabaseAdmin
    .from("repo_catalog_entries")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("repo_name");
  if (error) throw error;
  return (data ?? []) as RepoCatalogEntryRow[];
}

export async function matchReposForTask(
  ownerUserId: string,
  task: Pick<ExtractedTaskRow, "extracted_title" | "extracted_description" | "labels" | "missing_context" | "tracker_project">
) {
  const entries = await listRepoCatalog(ownerUserId);
  const query = buildTaskSearchText({
    title: task.extracted_title,
    description: task.extracted_description,
    labels: task.labels,
    missingContext: task.missing_context,
  });

  return entries
    .map((entry) => {
      const projectBoost = task.tracker_project && entry.project_key === task.tracker_project ? 0.2 : 0;
      const score = Math.min(1, textScore(query, entry.search_text) + projectBoost);
      return {
        repo: entry.repo_name,
        localPath: entry.local_path,
        projectKey: entry.project_key,
        score,
        reason: score > 0
          ? `Matched local catalog metadata for ${entry.repo_name}`
          : `No strong metadata match for ${entry.repo_name}`,
      };
    })
    .sort((a, b) => b.score - a.score);
}

async function collectTree(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > 4 || out.length >= 900) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (out.length >= 900) return;
      if (entry.name.startsWith(".") && entry.name !== ".github") {
        if (SKIP_DIRS.has(entry.name)) continue;
      }

      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(relative);
      }
    }
  }

  await walk(root, 0);
  return out.sort();
}

async function readFirstReadable(root: string, names: string[]): Promise<string> {
  for (const name of names) {
    const content = await readFile(path.join(root, name), "utf8").catch(() => null);
    if (content) return content.slice(0, 20000);
  }
  return "";
}

async function readPackageJson(root: string): Promise<Record<string, any>> {
  const content = await readFile(path.join(root, "package.json"), "utf8").catch(() => null);
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as Record<string, any>;
    return {
      name: parsed.name,
      description: parsed.description,
      keywords: parsed.keywords,
      scripts: parsed.scripts,
      dependencies: parsed.dependencies ? Object.keys(parsed.dependencies).slice(0, 80) : undefined,
    };
  } catch {
    return {};
  }
}

function firstHeading(markdown: string): string | null {
  const line = markdown.split("\n").find((part) => part.trim().startsWith("# "));
  return line ? line.replace(/^#\s+/, "").trim() : null;
}

function firstParagraph(markdown: string): string | null {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("#"));
  return paragraph ? paragraph.slice(0, 500) : null;
}
