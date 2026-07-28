/**
 * POST /api/distribution/execute
 * Executa a distribuição REAL (atribui owner + propaga + log). Trigger
 * manual. Exige `distribution:execute` (gestores) **ou**
 * `conversation:claim` (consultor redistribuindo do inbox) e o widget
 * `smart_distribution`.
 *
 * Body: {
 *   dealId?, contactId?, conversationId?,
 *   distributionType?,
 *   departmentId?, departmentIds?,
 *   reassign?  // true = redistribui mesmo com responsável atual
 * }
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
  departmentId: z.string().min(1).optional(),
  departmentIds: z.array(z.string().min(1)).max(50).optional(),
  reassign: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    const canExecute =
      can(ctx, "distribution:execute") || can(ctx, "conversation:claim");
    if (!canExecute) {
      return NextResponse.json(
        {
          message: "Acesso negado.",
          required: "distribution:execute|conversation:claim",
        },
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

    const departmentIds = Array.from(
      new Set(
        [
          ...(parsed.data.departmentIds ?? []),
          ...(parsed.data.departmentId ? [parsed.data.departmentId] : []),
        ].filter(Boolean),
      ),
    );

    try {
      const result = await executeDistribution({
        dealId: parsed.data.dealId,
        contactId: parsed.data.contactId,
        conversationId: parsed.data.conversationId,
        distributionType: parsed.data.distributionType ?? null,
        departmentIds: departmentIds.length > 0 ? departmentIds : null,
        reassign: parsed.data.reassign === true,
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
