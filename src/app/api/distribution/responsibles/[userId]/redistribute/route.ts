/**
 * POST /api/distribution/responsibles/[userId]/redistribute
 * Redistribui a fila do consultor (Entrada/Aguardando) para outros
 * responsáveis — igualmente entre ONLINE ou para destinatários escolhidos.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";
import { redistributeResponsibleQueue } from "@/services/distribution/redistribute";

type RouteContext = { params: Promise<{ userId: string }> };

const bodySchema = z
  .object({
    mode: z.enum(["equal", "specific"]),
    recipientUserIds: z.array(z.string().min(1)).max(50).optional(),
    queueScope: z.enum(["all", "entrada", "aguardando"]).optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.mode === "specific" &&
      (!val.recipientUserIds || val.recipientUserIds.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione ao menos um consultor destinatário.",
        path: ["recipientUserIds"],
      });
    }
  });

export async function POST(request: Request, context: RouteContext) {
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
            message:
              "Módulo de Distribuição não habilitado para esta organização.",
            code: "SMART_DISTRIBUTION_NOT_ENABLED",
          },
          { status: 403 },
        );
      }
      throw e;
    }

    const { userId } = await context.params;
    if (!userId) {
      return NextResponse.json({ message: "userId obrigatório." }, { status: 400 });
    }

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          message: parsed.error.issues[0]?.message ?? "Payload inválido.",
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    try {
      const result = await redistributeResponsibleQueue({
        sourceUserId: userId,
        mode: parsed.data.mode,
        recipientUserIds: parsed.data.recipientUserIds,
        queueScope: parsed.data.queueScope ?? "all",
        actor: {
          id: session.user.id,
          role: session.user.role as "ADMIN" | "MANAGER" | "MEMBER",
        },
      });
      return NextResponse.json({ result });
    } catch (e) {
      const err = e as { message?: string; code?: string; status?: number };
      const status = typeof err.status === "number" ? err.status : 500;
      return NextResponse.json(
        {
          message: err.message ?? "Erro ao redistribuir fila.",
          code: err.code,
        },
        { status },
      );
    }
  });
}
