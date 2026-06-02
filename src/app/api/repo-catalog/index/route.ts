import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, ValidationError } from "@/lib/errors";
import { indexLocalRepo, listRepoCatalog } from "@/lib/learning/local-repo-reader";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const repos = await listRepoCatalog(user.id);
    return NextResponse.json({ repos });
  } catch (err) {
    return apiError(err, { route: "repo-catalog/index" });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    if (typeof body.localPath !== "string" || !body.localPath.trim()) {
      throw new ValidationError("localPath is required");
    }

    const repo = await indexLocalRepo({
      ownerUserId: user.id,
      localPath: body.localPath,
      projectKey: typeof body.projectKey === "string" ? body.projectKey : null,
      repoName: typeof body.repoName === "string" ? body.repoName : null,
    });

    return NextResponse.json({ repo }, { status: 201 });
  } catch (err) {
    return apiError(err, { route: "repo-catalog/index" });
  }
}
