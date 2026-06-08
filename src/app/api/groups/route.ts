import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const VALID_CHANNEL_TYPES = new Set(["whatsapp", "instagram", "email", "meta"]);

function validateChannelGrants(grants: unknown[]): string | null {
  for (const g of grants) {
    if (typeof g !== "string") return `Valor inválido: ${String(g)}`;
    const [type] = g.split(":");
    if (!VALID_CHANNEL_TYPES.has(type)) {
      return `Tipo de canal inválido: "${type}". Válidos: whatsapp, instagram, email, meta`;
    }
  }
  return null;
}

export async function GET() {
  const r = await requireCan("group:view");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const groups = await prisma.userGroup.findMany({
    where: { organizationId: ctx.organizationId },
    include: {
      role: { select: { id: true, name: true, systemPreset: true } },
      _count: { select: { members: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(groups);
}

export async function POST(request: Request) {
  const r = await requireCan("group:manage");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) {
    return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
  }

  const description =
    typeof b.description === "string" ? b.description.trim() || null : null;
  const color = typeof b.color === "string" ? b.color.trim() || null : null;
  const channelGrants = Array.isArray(b.channelGrants) ? (b.channelGrants as unknown[]) : [];
  const stageGrants = Array.isArray(b.stageGrants) ? (b.stageGrants as unknown[]) : [];
  const roleId = typeof b.roleId === "string" ? b.roleId : null;

  const channelError = validateChannelGrants(channelGrants);
  if (channelError) {
    return NextResponse.json({ message: channelError }, { status: 400 });
  }

  const stageIds = stageGrants.filter((s): s is string => typeof s === "string");
  if (stageIds.length > 0) {
    const found = await prisma.stage.count({
      where: { id: { in: stageIds }, pipeline: { organizationId: ctx.organizationId } },
    });
    if (found !== stageIds.length) {
      return NextResponse.json(
        { message: "Um ou mais stageIds não pertencem a esta organização." },
        { status: 400 },
      );
    }
  }

  if (roleId) {
    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organizationId },
    });
    if (!role) {
      return NextResponse.json(
        { message: "Role não encontrado nesta organização." },
        { status: 404 },
      );
    }
  }

  const existing = await prisma.userGroup.findFirst({
    where: { organizationId: ctx.organizationId, name },
  });
  if (existing) {
    return NextResponse.json(
      { message: `Já existe um grupo com o nome "${name}".` },
      { status: 409 },
    );
  }

  const group = await prisma.userGroup.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      description,
      color,
      roleId,
      channelGrants: channelGrants as string[],
      stageGrants: stageIds,
    },
    include: {
      role: { select: { id: true, name: true, systemPreset: true } },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json(group, { status: 201 });
}
