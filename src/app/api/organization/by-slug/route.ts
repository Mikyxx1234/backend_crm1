import { NextResponse } from "next/server";

import { getClientIp, withRateLimit } from "@/lib/rate-limit";
import { prismaBase } from "@/lib/prisma-base";

/**
 * Lookup público leve: o middleware FE valida se o subdomain Host
 * corresponde a uma Organization ACTIVE antes de deixar o app carregar.
 *
 * Não exige sessão. Payload mínimo (slug + name) — sem ids internos
 * nem dados sensíveis. Rate-limit por IP (`auth.public`).
 *
 * GET /api/organization/by-slug?slug=acme
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rl = await withRateLimit({
    route: "organization.by-slug",
    profile: "auth.public",
    scope: "ip",
    id: ip,
  });
  if (!rl.ok) return rl.response;

  const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase() ?? "";
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { message: "Slug inválido.", code: "INVALID_SLUG" },
      { status: 400, headers: rl.headers },
    );
  }

  const org = await prismaBase.organization.findUnique({
    where: { slug },
    select: { slug: true, name: true, status: true },
  });

  if (!org || org.status !== "ACTIVE") {
    return NextResponse.json(
      { message: "Organização não encontrada.", code: "ORG_NOT_FOUND" },
      { status: 404, headers: rl.headers },
    );
  }

  return NextResponse.json(
    { ok: true as const, slug: org.slug, name: org.name },
    { status: 200, headers: rl.headers },
  );
}
