import { supabaseAdmin } from "@/lib/supabase";

export interface CodeHit {
  path: string;
  repository: string;
  score: number;
}

export interface RepoTreeEntry {
  path: string;
  type: "blob" | "tree";
}

export interface RepoReader {
  searchCode(repo: string, query: string): Promise<CodeHit[]>;
  getFileContent(repo: string, path: string, ref?: string): Promise<string>;
  getRepoTree(repo: string, ref?: string): Promise<RepoTreeEntry[]>;
  getReadme(repo: string, ref?: string): Promise<string | null>;
  getDefaultBranch(repo: string): Promise<{ branch: string; sha: string }>;
}

function token() {
  const t = process.env.GITHUB_READONLY_TOKEN;
  if (!t) throw new Error("GITHUB_READONLY_TOKEN is required");
  return t;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function assertAllowlisted(repo: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("project_repos")
    .select("id")
    .eq("repo_full_name", repo)
    .limit(1);
  if (!data || data.length === 0) throw new Error(`Repo not allowlisted: ${repo}`);
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GitHub API error ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export class HttpRepoReader implements RepoReader {
  async searchCode(repo: string, query: string): Promise<CodeHit[]> {
    await assertAllowlisted(repo);
    const q = encodeURIComponent(`${query} repo:${repo}`);
    const data = await gh<{ items: Array<{ path: string; score: number }> }>(`/search/code?q=${q}&per_page=20`);
    return data.items.map((i) => ({ path: i.path, repository: repo, score: i.score ?? 0 }));
  }

  async getFileContent(repo: string, path: string, ref?: string): Promise<string> {
    await assertAllowlisted(repo);
    const [owner, name] = repo.split("/");
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const data = await gh<{ content: string; encoding: string }>(
      `/repos/${owner}/${name}/contents/${encodePath(path)}${qs}`
    );
    if (!data.content || data.encoding !== "base64") throw new Error(`Unsupported content for ${path}`);
    return Buffer.from(data.content, "base64").toString("utf8");
  }

  async getRepoTree(repo: string, ref?: string): Promise<RepoTreeEntry[]> {
    await assertAllowlisted(repo);
    const [owner, name] = repo.split("/");
    const sha = ref ?? (await this.getDefaultBranch(repo)).sha;
    const data = await gh<{ tree: Array<{ path: string; type: "blob" | "tree" }> }>(
      `/repos/${owner}/${name}/git/trees/${sha}?recursive=1`
    );
    return data.tree
      .filter((t) => t.path && (t.type === "blob" || t.type === "tree"))
      .map((t) => ({ path: t.path, type: t.type }));
  }

  async getReadme(repo: string, ref?: string): Promise<string | null> {
    try {
      return await this.getFileContent(repo, "README.md", ref);
    } catch {
      return null;
    }
  }

  async getDefaultBranch(repo: string): Promise<{ branch: string; sha: string }> {
    await assertAllowlisted(repo);
    const [owner, name] = repo.split("/");
    const info = await gh<{ default_branch: string }>(`/repos/${owner}/${name}`);
    const branch = await gh<{ commit: { sha: string } }>(`/repos/${owner}/${name}/branches/${info.default_branch}`);
    return { branch: info.default_branch, sha: branch.commit.sha };
  }
}

interface ComposioProxyResponse<T> {
  status: number;
  data: T;
  error?: unknown;
}

function composioApiKey() {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY is required");
  return key;
}

function composioConnectedAccountId() {
  const id = process.env.COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID;
  if (!id) throw new Error("COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID is required");
  return id;
}

async function composioProxy<T>(
  endpoint: string,
  parameters: Array<{ name: string; value: string; type: "query" | "header" }> = []
): Promise<T> {
  const baseUrl = process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev/api/v3.1";
  const res = await fetch(`${baseUrl}/tools/execute/proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": composioApiKey(),
    },
    body: JSON.stringify({
      endpoint,
      method: "GET",
      connected_account_id: composioConnectedAccountId(),
      parameters,
    }),
  });

  if (!res.ok) {
    throw new Error(`Composio API error ${res.status} on ${endpoint}`);
  }

  const payload = (await res.json()) as ComposioProxyResponse<T>;
  if (payload.status >= 400) {
    throw new Error(`GitHub API error ${payload.status} via Composio on ${endpoint}`);
  }
  return payload.data;
}

export class ComposioRepoReader implements RepoReader {
  async searchCode(repo: string, query: string): Promise<CodeHit[]> {
    await assertAllowlisted(repo);
    const data = await composioProxy<{ items: Array<{ path: string; score: number }> }>(
      "/search/code",
      [
        { name: "q", value: `${query} repo:${repo}`, type: "query" },
        { name: "per_page", value: "20", type: "query" },
      ]
    );
    return data.items.map((i) => ({ path: i.path, repository: repo, score: i.score ?? 0 }));
  }

  async getFileContent(repo: string, path: string, ref?: string): Promise<string> {
    await assertAllowlisted(repo);
    const [owner, name] = repo.split("/");
    const parameters = ref
      ? [{ name: "ref", value: ref, type: "query" as const }]
      : [];
    const data = await composioProxy<{ content: string; encoding: string }>(
      `/repos/${owner}/${name}/contents/${encodePath(path)}`,
      parameters
    );
    if (!data.content || data.encoding !== "base64") throw new Error(`Unsupported content for ${path}`);
    return Buffer.from(data.content, "base64").toString("utf8");
  }

  async getRepoTree(repo: string, ref?: string): Promise<RepoTreeEntry[]> {
    await assertAllowlisted(repo);
    const [owner, name] = repo.split("/");
    const sha = ref ?? (await this.getDefaultBranch(repo)).sha;
    const data = await composioProxy<{ tree: Array<{ path: string; type: "blob" | "tree" }> }>(
      `/repos/${owner}/${name}/git/trees/${sha}`,
      [{ name: "recursive", value: "1", type: "query" }]
    );
    return data.tree
      .filter((t) => t.path && (t.type === "blob" || t.type === "tree"))
      .map((t) => ({ path: t.path, type: t.type }));
  }

  async getReadme(repo: string, ref?: string): Promise<string | null> {
    try {
      return await this.getFileContent(repo, "README.md", ref);
    } catch {
      return null;
    }
  }

  async getDefaultBranch(repo: string): Promise<{ branch: string; sha: string }> {
    await assertAllowlisted(repo);
    const [owner, name] = repo.split("/");
    const info = await composioProxy<{ default_branch: string }>(`/repos/${owner}/${name}`);
    const branch = await composioProxy<{ commit: { sha: string } }>(
      `/repos/${owner}/${name}/branches/${info.default_branch}`
    );
    return { branch: info.default_branch, sha: branch.commit.sha };
  }
}

export function getRepoReader(): RepoReader {
  if (process.env.REPO_READER_PROVIDER === "composio") {
    return new ComposioRepoReader();
  }
  return new HttpRepoReader();
}
