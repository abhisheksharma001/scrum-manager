import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

const CORS_ORIGINS =
  process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [];

export async function proxy(request: NextRequest) {
  if (request.method === "OPTIONS") {
    return handleCors(request, new NextResponse(null, { status: 204 }));
  }

  // Refresh Supabase session cookie; redirects unauthenticated page
  // visitors to /login while letting API routes through (API auth is
  // enforced per-route via requireAuth / requireAdmin).
  const response = await updateSession(request);

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return handleCors(request, response);
  }

  return response;
}

function handleCors(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  if (CORS_ORIGINS.length === 0) return response;

  const origin = request.headers.get("origin");
  if (origin && CORS_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,OPTIONS"
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,x-webhook-secret"
    );
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Max-Age", "86400");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
