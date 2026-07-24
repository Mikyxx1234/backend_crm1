/**
 * GET/PUT /api/distribution/settings
 * Configurações org-scoped da Distribuição Inteligente.
 *
 * Hoje expõe apenas `respectDepartment`:
 *   - false (default): distribuição CLÁSSICA org-wide (todos os elegíveis),
 *     ignorando departamento — nada fica preso na fila por falta de roteamento.
 *   - true: quando a conversa tem um departamento com distribuição automática
 *     ligada, restringe aos membros desse departamento; sem departamento cai
 *     no org-wide.
 *
 * Gateado por `smart_distribution` + `distribution:execute`.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { getOrgSettingBool, setOrgSettingBool } from "@/lib/org-settings";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";

const KEY = "distribution.respectDepartment";

async function guard(session: {
  user: { id: string; organizationId: string | null; isSuperAdmin: boolean };
}): Promise<NextResponse | null> {
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
  return null;
}

export async function GET() {
  return withOrgContext(async (session) => {
    const denied = await guard(session);
    if (denied) return denied;
    const respectDepartment = await getOrgSettingBool(KEY, false);
    return NextResponse.json({ respectDepartment });
  });
}

export async function PUT(req: Request) {
  return withOrgContext(async (session) => {
    const denied = await guard(session);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      respectDepartment?: unknown;
    };
    const respectDepartment = Boolean(body?.respectDepartment);
    await setOrgSettingBool(KEY, respectDepartment);
    return NextResponse.json({ respectDepartment });
  });
}
