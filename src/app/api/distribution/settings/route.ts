/**
 * GET   /api/distribution/settings  -> { distributeByDepartment }
 * PATCH /api/distribution/settings  -> { distributeByDepartment }
 *
 * Config de nível-org da Distribuição Inteligente. Gateado pelo widget
 * `smart_distribution`. GET exige `distribution:view`; PATCH `distribution:manage`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";
import {
  getDistributionSettings,
  setDistributionSettings,
} from "@/services/distribution";

const PatchSchema = z.object({
  distributeByDepartment: z.boolean().optional(),
});

async function ensureWidget(): Promise<NextResponse | null> {
  try {
    await assertSmartDistributionEnabled();
    return null;
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
}

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
    const gate = await ensureWidget();
    if (gate) return gate;

    const settings = await getDistributionSettings();
    return NextResponse.json(settings);
  });
}

export async function PATCH(request: Request) {
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
    const gate = await ensureWidget();
    if (gate) return gate;

    const body = await request.json().catch(() => ({}));
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", errors: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const settings = await setDistributionSettings(parsed.data);
    return NextResponse.json(settings);
  });
}
