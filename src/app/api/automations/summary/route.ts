import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermission } from "@/lib/authz";
import { getAutomationListSummary } from "@/services/automations";

/**
 * GET /api/automations/summary
 *
 * Totais da org para KPIs / popover da listagem — COUNTs + logs só de hoje.
 * Substitui o segundo GET `/api/automations?perPage=200` no first paint.
 */
export async function GET() {
  return withOrgContext(async (session) => {
    const denied = await requirePermission(session.user, "automation:view");
    if (denied) return denied;
    try {
      const summary = await getAutomationListSummary();
      return NextResponse.json(summary);
    } catch (e) {
      console.error("[GET /api/automations/summary]", e);
      return NextResponse.json(
        { message: "Erro ao carregar resumo de automações." },
        { status: 500 },
      );
    }
  });
}
