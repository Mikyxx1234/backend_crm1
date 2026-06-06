import { NextResponse } from "next/server";

import { isAdmin, withOrgContext } from "@/lib/auth-helpers";
import { WIDGET_SLUGS } from "@/lib/widget-catalog";
import {
  InvalidWidgetSlugError,
  uninstallWidget,
} from "@/services/organization-widgets";

/**
 * POST /api/widgets/uninstall
 * Body: { slug: string }
 * Desativa um widget para a organizacao (status INACTIVE, sem delete). Apenas ADMIN.
 * TODO(authz): migrar para permission key "settings:widgets" quando existir.
 */
export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    if (!isAdmin(session)) {
      return NextResponse.json(
        { message: "Apenas administradores podem remover widgets." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
    } | null;
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    if (!slug || !WIDGET_SLUGS.has(slug)) {
      return NextResponse.json(
        { message: "Widget inválido." },
        { status: 400 },
      );
    }

    try {
      await uninstallWidget(slug);
      return NextResponse.json({ slug, installed: false });
    } catch (e) {
      if (e instanceof InvalidWidgetSlugError) {
        return NextResponse.json({ message: "Widget inválido." }, { status: 400 });
      }
      console.error("[POST /api/widgets/uninstall]", e);
      return NextResponse.json(
        { message: "Erro ao remover widget." },
        { status: 500 },
      );
    }
  });
}
