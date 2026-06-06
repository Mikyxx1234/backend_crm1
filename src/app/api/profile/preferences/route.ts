/**
 * GET /api/profile/preferences
 * Preferencias pessoais do usuario autenticado: `sidebar` e `dashboard`.
 * Se nunca salvou, retorna o padrao (catalogo, todos habilitados).
 *
 * Tambem devolve `availableKeys`: o conjunto de keys de sidebar liberadas
 * para o usuario (gateadas por permission + widgets ativos da org). O
 * frontend usa essa lista para nunca renderizar/auto-anexar itens gateados.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { getActiveWidgetSlugs } from "@/services/organization-widgets";
import {
  computeAvailableKeys,
  getDashboardPreferences,
  getSidebarPreferences,
} from "@/services/user-preferences";

export async function GET() {
  return withOrgContext(async (session) => {
    try {
      const ctx = await loadAuthzContext({
        userId: session.user.id,
        organizationId: session.user.organizationId,
        isSuperAdmin: session.user.isSuperAdmin,
      });
      const activeSlugs = await getActiveWidgetSlugs();
      const availableKeys = computeAvailableKeys(
        (key) => can(ctx, key),
        (slug) => activeSlugs.has(slug),
      );

      const [sidebar, dashboard] = await Promise.all([
        getSidebarPreferences(session.user.id, availableKeys),
        getDashboardPreferences(session.user.id),
      ]);
      return NextResponse.json({
        sidebar,
        dashboard,
        availableKeys: [...availableKeys],
      });
    } catch (e) {
      console.error("[GET /api/profile/preferences]", e);
      return NextResponse.json(
        { message: "Erro ao carregar preferências." },
        { status: 500 },
      );
    }
  });
}
