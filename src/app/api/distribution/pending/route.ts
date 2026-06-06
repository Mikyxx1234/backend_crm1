/**
 * GET /api/distribution/pending
 * Lista os leads na fila de espera da Distribuição (não distribuídos por
 * falta de responsável elegível). Gateado por `smart_distribution` +
 * `distribution:view`.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { getPendingDistributions } from "@/services/distribution";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";

export async function GET() {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "distribution:view")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "distribution:view" },
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

    try {
      const pending = await getPendingDistributions();
      return NextResponse.json({ pending });
    } catch (e) {
      console.error("[GET /api/distribution/pending]", e);
      return NextResponse.json(
        { message: "Erro ao carregar a fila de espera." },
        { status: 500 },
      );
    }
  });
}
