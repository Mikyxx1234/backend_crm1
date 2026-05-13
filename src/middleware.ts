import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD";
const CORS_HEADERS =
  "Authorization, Content-Type, X-Requested-With, Accept, Origin, Cookie, X-CSRF-Token";

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function pickAllowOrigin(requestOrigin: string | null, allowed: string[]): string | null {
  if (!requestOrigin || allowed.length === 0) return null;
  if (allowed.includes(requestOrigin)) return requestOrigin;
  return null;
}

function applyCors(response: NextResponse, request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const allowed = parseAllowedOrigins();
  const allowOrigin = pickAllowOrigin(origin, allowed);
  if (allowOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowOrigin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }
  response.headers.set("Access-Control-Allow-Methods", CORS_METHODS);
  response.headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

export function middleware(request: NextRequest) {
  if (request.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    return applyCors(res, request);
  }
  return applyCors(NextResponse.next(), request);
}

export const config = {
  matcher: ["/api/:path*", "/health"],
};
