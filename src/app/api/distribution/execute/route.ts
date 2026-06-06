/**
 * POST /api/distribution/execute
 * Executa a distribuição REAL (atribui owner + propaga + log). Trigger
 * manual. Exige `distribution:execute` e o widget `smart_distribution`.
 *
 * Body: { dealId?, contactId?, conversationId?, distributionType? }
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { executeDistribution } from "@/services/distribution";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";

const bodySchema = z.object({
  dealId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  distributionType: z.string().trim().max(100).nullable().optional(),
});

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "distribution:execute")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "distribution:execute" },
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

    let json: unknown = {};
    try {
      json = await request.json();
    } catch {
      // corpo vazio é aceitável (seleção sem alvo)
    }
    const parsed = bodySchema.safeParse(json ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const result = await executeDistribution({
        ...parsed.data,
        triggerSource: "MANUAL",
      });
      return NextResponse.json(result);
    } catch (e) {
      console.error("[POST /api/distribution/execute]", e);
      return NextResponse.json(
        { message: "Erro ao executar distribuição." },
        { status: 500 },
      );
    }
  });
}
