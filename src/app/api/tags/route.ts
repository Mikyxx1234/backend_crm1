import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import type { AppUserRole } from "@/lib/auth-types";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    const url = new URL(request.url);
    const withCounts = url.searchParams.get("counts") === "1";

    if (withCounts) {
      const tags = await prisma.$queryRaw<
        { id: string; name: string; color: string; dealCount: number; contactCount: number }[]
      >`
        SELECT t.id, t.name, t.color,
          (SELECT COUNT(*)::int FROM tags_on_deals  WHERE "tagId" = t.id) AS "dealCount",
          (SELECT COUNT(*)::int FROM tags_on_contacts WHERE "tagId" = t.id) AS "contactCount"
        FROM tags t ORDER BY t.name
      `;
      return NextResponse.json(tags);
    }

    const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json(tags);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao listar tags." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    const role = authResult.user.role as AppUserRole;
    if (role !== "ADMIN" && role !== "MANAGER") {
      return NextResponse.json({ message: "Sem permissão para criar tags." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ message: "JSON inválido." }, { status: 400 });

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ message: "Nome da tag é obrigatório." }, { status: 400 });

    const color = typeof body.color === "string" ? body.color.trim() : undefined;

    const tag = await prisma.tag.create({ data: { name, color } });
    return NextResponse.json(tag, { status: 201 });
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      return NextResponse.json({ message: "Já existe uma tag com este nome." }, { status: 409 });
    }
    return NextResponse.json({ message: "Erro ao criar tag." }, { status: 500 });
  }
}
