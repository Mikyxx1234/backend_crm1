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
    /** Sincroniza os departamentos do responsável (substitui o conjunto). */
    departmentIds: z.array(z.string().min(1)).max(100).optional(),
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
      const { departmentIds, ...respData } = parsed.data;

      // Sincroniza os departamentos do responsável (substitui o conjunto),
      // validando que pertencem à org. Isolado em try para não derrubar a
      // rota caso a tabela `department_members` ainda não exista no ambiente.
      if (departmentIds) {
        try {
          const validDepts = await prisma.department.findMany({
            where: { id: { in: departmentIds }, organizationId: orgId },
            select: { id: true },
          });
          const desired = new Set(validDepts.map((d) => d.id));
          const current = await prisma.departmentMember.findMany({
            where: { userId, organizationId: orgId },
            select: { departmentId: true },
          });
          const currentIds = new Set(current.map((c) => c.departmentId));
          const toAdd = [...desired].filter((id) => !currentIds.has(id));
          const toRemove = [...currentIds].filter((id) => !desired.has(id));
          await prisma.$transaction([
            ...(toRemove.length
              ? [
                  prisma.departmentMember.deleteMany({
                    where: { userId, organizationId: orgId, departmentId: { in: toRemove } },
                  }),
                ]
              : []),
            ...toAdd.map((departmentId) =>
              prisma.departmentMember.create({
                data: { organizationId: orgId, userId, departmentId },
              }),
            ),
          ]);
        } catch (e) {
          console.error("[PATCH responsibles] falha ao sincronizar departamentos", e);
          return NextResponse.json(
            { message: "Erro ao atualizar departamentos do responsável." },
            { status: 500 },
          );
        }
      }

      // Só faz upsert da config quando houver campo de config no corpo.
      let responsible = null as null | {
        userId: string;
        participates: boolean;
        queueLimit: number;
        volume: number;
        type: string | null;
        paused: boolean;
        lastExecutionAt: Date | null;
      };
      if (Object.keys(respData).length > 0) {
        responsible = await prisma.distributionResponsible.upsert({
          where: {
            organizationId_userId: { organizationId: orgId, userId },
          },
          update: respData,
          create: { organizationId: orgId, userId, ...respData },
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
      }

      return NextResponse.json({
        responsible: responsible
          ? {
              ...responsible,
              lastExecutionAt: responsible.lastExecutionAt
                ? responsible.lastExecutionAt.toISOString()
                : null,
            }
          : null,
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
