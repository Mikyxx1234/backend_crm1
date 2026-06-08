import { NextResponse } from "next/server";

import { requireAuthWithCtx, requireCan } from "@/lib/auth-helpers";
import { can } from "@/lib/authz";
import {
  resolveChannelGrants,
  resolveEffectivePermissions,
  resolveStageGrants,
} from "@/lib/authz/resolve-permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id: targetUserId } = await params;

  // Aceita: quem tem settings:users OU o próprio usuário
  const r = await requireAuthWithCtx();
  if (!r.ok) return r.response;
  const { ctx } = r;

  const isSelf = ctx.userId === targetUserId;
  const canManage = can(ctx, "settings:users");

  if (!isSelf && !canManage) {
    return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
  }

  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!targetUser) {
    return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
  }

  const [permissions, channelGrants, stageGrants, assignments, memberships] = await Promise.all([
    resolveEffectivePermissions(targetUserId, ctx.organizationId),
    resolveChannelGrants(targetUserId),
    resolveStageGrants(targetUserId),
    prisma.userRoleAssignment.findMany({
      where: { userId: targetUserId, organizationId: ctx.organizationId },
      include: { role: { select: { id: true, name: true, systemPreset: true } } },
    }),
    prisma.userGroupMember.findMany({
      where: { userId: targetUserId },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            channelGrants: true,
            stageGrants: true,
            organizationId: true,
          },
        },
      },
    }),
  ]);

  // Filtrar grupos da org atual
  const groups = memberships
    .filter((m) => m.group.organizationId === ctx.organizationId)
    .map((m) => m.group);

  return NextResponse.json({
    permissions,
    channelGrants,
    stageGrants,
    roles: assignments.map((a) => a.role),
    groups,
  });
}
