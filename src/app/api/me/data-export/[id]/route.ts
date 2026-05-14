import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDataRequest } from "@/services/lgpd";
import { logAudit } from "@/lib/audit/log";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * `GET /api/me/data-export/:id`
 *
 * Retorna metadata de um pedido de export especifico do user logado.
 * Loga `data_export_download` quando o cliente acessa um export
 * READY (heuristic — UI vai chamar GET antes de redirecionar pro
 * downloadKey, entao registramos isso).
 *
 * @see docs/lgpd.md
 */
export async function GET(_req: Request, ctx: RouteContext) {
  const session = await auth();
  const user = session?.user as
    | { id?: string; organizationId?: string | null }
    | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const item = await getDataRequest(id, user.id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (item.status === "READY" && item.downloadKey) {
    await logAudit({
      entity: "data_export",
      action: "data_export_download",
      entityId: item.id,
      organizationId: user.organizationId ?? null,
      actorId: user.id,
    });
  }

  return NextResponse.json(item);
}
