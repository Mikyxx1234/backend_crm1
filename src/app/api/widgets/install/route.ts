import { NextResponse } from "next/server";

import { isAdmin, withOrgContext } from "@/lib/auth-helpers";
import { WIDGET_SLUGS } from "@/lib/widget-catalog";
import {
  InvalidWidgetSlugError,
  installWidget,
} from "@/services/organization-widgets";

/**
 * POST /api/widgets/install
 * Body: { slug: string }
 * Instala/reativa um widget para a organizacao. Apenas ADMIN.
 * TODO(authz): migrar para permission key "settings:widgets" quando existir.
 */
export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    if (!isAdmin(session)) {
      return NextResponse.json(
        { message: "Apenas administradores podem instalar widgets." },
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
      await installWidget(slug, session.user.id);
      return NextResponse.json({ slug, installed: true });
    } catch (e) {
      if (e instanceof InvalidWidgetSlugError) {
        return NextResponse.json({ message: "Widget inválido." }, { status: 400 });
      }
      console.error("[POST /api/widgets/install]", e);
      return NextResponse.json(
        { message: "Erro ao instalar widget." },
        { status: 500 },
      );
    }
  });
}
