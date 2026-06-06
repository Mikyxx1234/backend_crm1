/**
 * PATCH /api/distribution/responsibles/[userId]
 * Atualiza a config administrativa de um responsável (participa, limite de
 * fila, volume, tipo, pausa). Online/offline NÃO é alterado aqui — isso vai
 * por `PUT /api/agents/[id]/status`. Exige `distribution:manage` e o widget
 * `smart_distribution` ativo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";

type RouteContext = { params: Promise<{ userId: string }> };

const bodySchema = z
  .object({
    participates: z.boolean().optional(),
    paused: z.boolean().optional(),
    queueLimit: z.number().int().min(0).max(100_000).optional(),
    volume: z.number().int().min(1).max(100_000).optional(),
    type: z.string().trim().max(100).nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Nenhum campo para atualizar.",
  });

export async function PATCH(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "distribution:manage")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "distribution:manage" },
        { status: 403 },
      );
    }

    try {
      await assertSmartDistributionEnabled();
    } catch (e) {
      if (e instanceof WidgetNotEnabledError) {
        return NextResponse.json(
          {
            message: "Módulo de Distribuição não habilitado para esta organização.",
            code: "SMART_DISTRIBUTION_NOT_ENABLED",
          },
          { status: 403 },
        );
      }
      throw e;
    }

    const { userId } = await context.params;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const orgId = getOrgIdOrThrow();

    // Garante que o alvo é um operador humano desta organização.
    const target = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId, type: "HUMAN" },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json(
        { message: "Usuário não encontrado nesta organização." },
        { status: 404 },
      );
    }

    try {
      const data = parsed.data;
      const responsible = await prisma.distributionResponsible.upsert({
        where: {
          organizationId_userId: { organizationId: orgId, userId },
        },
        update: data,
        create: { organizationId: orgId, userId, ...data },
        select: {
          userId: true,
          participates: true,
          queueLimit: true,
          volume: true,
          type: true,
          paused: true,
          lastExecutionAt: true,
        },
      });
      return NextResponse.json({
        responsible: {
          ...responsible,
          lastExecutionAt: responsible.lastExecutionAt
            ? responsible.lastExecutionAt.toISOString()
            : null,
        },
      });
    } catch (e) {
      console.error("[PATCH /api/distribution/responsibles/[userId]]", e);
      return NextResponse.json(
        { message: "Erro ao atualizar responsável." },
        { status: 500 },
      );
    }
  });
}
