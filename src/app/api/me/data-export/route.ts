import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { listMyDataRequests, requestExport } from "@/services/lgpd";

/**
 * `POST /api/me/data-export`
 *
 * Cria + processa inline um export do user logado (LGPD Art. 18, IV).
 * Retorna `{ id, downloadUrl, status }`. URL e gateada por
 * `/api/storage/[...path]` — so o owner ou super-admin baixa.
 *
 * `GET /api/me/data-export`
 *
 * Lista os pedidos de export feitos pelo user (max 50 mais recentes).
 *
 * @see docs/lgpd.md
 */
export async function POST(_req: Request) {
  const session = await auth();
  const user = session?.user as
    | { id?: string; organizationId?: string | null }
    | undefined;
  if (!user?.id || !user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await requestExport({
      userId: user.id,
      organizationId: user.organizationId,
      requestedById: user.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao gerar export.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await listMyDataRequests(user.id);
  return NextResponse.json({ items });
}
