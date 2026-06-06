/**
 * PATCH /api/profile/preferences/sidebar
 * Body: { items: [{ key: string, enabled: boolean, order: number }] }
 *
 * Salva a personalizacao da sidebar do usuario autenticado. O `userId` vem
 * SEMPRE da sessao (nunca do body). O service normaliza contra o catalogo +
 * `availableKeys` (gating por permission + widgets ativos): descarta keys
 * invalidas/sem permissao/sem widget, forca itens `locked`, anexa itens novos
 * e reescreve a ordem. Retorna a versao final normalizada + `availableKeys`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { getActiveWidgetSlugs } from "@/services/organization-widgets";
import {
  computeAvailableKeys,
  saveSidebarPreferences,
} from "@/services/user-preferences";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        enabled: z.boolean(),
        order: z.number().int().min(0).max(1000),
      }),
    )
    .max(100),
});

export async function PATCH(request: Request) {
  return withOrgContext(async (session) => {
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

      const sidebar = await saveSidebarPreferences(
        session.user.id,
        parsed.data.items,
        availableKeys,
      );
      return NextResponse.json({ sidebar, availableKeys: [...availableKeys] });
    } catch (e) {
      console.error("[PATCH /api/profile/preferences/sidebar]", e);
      return NextResponse.json(
        { message: "Erro ao salvar preferências." },
        { status: 500 },
      );
    }
  });
}
