/**
 * GET /api/distribution/responsibles
 * Lista os responsáveis da Distribuição (usuários + config + presença +
 * expediente + fila atual + elegibilidade). Gateado pelo widget
 * `smart_distribution` e pela permissão `distribution:view`.
 *
 * Query: `?type=<segmento>` (opcional) avalia `TYPE_INCOMPATIBLE`.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { getDistributionResponsibles } from "@/services/distribution";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";

export async function GET(request: Request) {
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
      const type = new URL(request.url).searchParams.get("type");
      const responsibles = await getDistributionResponsibles({
        distributionType: type,
      });
      return NextResponse.json({ responsibles });
    } catch (e) {
      console.error("[GET /api/distribution/responsibles]", e);
      return NextResponse.json(
        { message: "Erro ao carregar responsáveis." },
        { status: 500 },
      );
    }
  });
}
