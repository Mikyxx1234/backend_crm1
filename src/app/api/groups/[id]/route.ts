import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { invalidateAuthzForOrg } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

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

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const r = await requireCan("group:view");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      role: { select: { id: true, name: true, systemPreset: true, permissions: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          role: { select: { id: true, name: true, systemPreset: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!group) {
    return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  }

  return NextResponse.json(group);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const r = await requireCan("group:manage");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!group) {
    return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (typeof b.name === "string") {
    const name = b.name.trim();
    if (!name) {
      return NextResponse.json({ message: "Nome não pode ser vazio." }, { status: 400 });
    }
    const conflict = await prisma.userGroup.findFirst({
      where: { organizationId: ctx.organizationId, name, NOT: { id } },
    });
    if (conflict) {
      return NextResponse.json(
        { message: `Já existe um grupo com o nome "${name}".` },
        { status: 409 },
      );
    }
    data.name = name;
  }

  if (b.description !== undefined) {
    data.description =
      typeof b.description === "string" ? b.description.trim() || null : null;
  }

  if (b.color !== undefined) {
    data.color = typeof b.color === "string" ? b.color.trim() || null : null;
  }

  if (typeof b.isActive === "boolean") {
    data.isActive = b.isActive;
  }

  let roleChanged = false;
  if (b.roleId !== undefined) {
    if (b.roleId === null) {
      data.roleId = null;
      roleChanged = true;
    } else if (typeof b.roleId === "string") {
      const role = await prisma.role.findFirst({
        where: { id: b.roleId, organizationId: ctx.organizationId },
      });
      if (!role) {
        return NextResponse.json(
          { message: "Role não encontrado nesta organização." },
          { status: 404 },
        );
      }
      data.roleId = b.roleId;
      roleChanged = true;
    }
  }

  if (b.channelGrants !== undefined) {
    const grants = Array.isArray(b.channelGrants) ? (b.channelGrants as unknown[]) : [];
    const err = validateChannelGrants(grants);
    if (err) return NextResponse.json({ message: err }, { status: 400 });
    data.channelGrants = grants as string[];
  }

  if (b.stageGrants !== undefined) {
    const stageIds = Array.isArray(b.stageGrants)
      ? (b.stageGrants as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
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
    data.stageGrants = stageIds;
  }

  const updated = await prisma.userGroup.update({
    where: { id },
    data,
    include: {
      role: { select: { id: true, name: true, systemPreset: true } },
      _count: { select: { members: true } },
    },
  });

  if (roleChanged) {
    await invalidateAuthzForOrg(ctx.organizationId);
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const r = await requireCan("group:manage");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!group) {
    return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  }

  await prisma.userGroup.delete({ where: { id } });
  await invalidateAuthzForOrg(ctx.organizationId);

  return NextResponse.json({ ok: true });
}
