/**
 * GET /api/storage/<organizationId>/<bucket>/<fileName>
 *
 * Gateway autenticado para arquivos persistidos pelo módulo
 * `src/lib/storage/local.ts`. Garante isolamento multi-tenant: a
 * sessão atual precisa ter `organizationId === <organizationId>`
 * (ou ser super-admin) — caso contrário responde 404 (sem revelar
 * existência do arquivo).
 *
 * O endpoint legacy `/api/uploads/[...path]` continua funcionando até
 * o backfill mover todos os arquivos pra layout novo (PR 1.3 backfill).
 *
 * @see docs/storage-tenancy.md
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { parseStoragePath, readStoredFile } from "@/lib/storage/local";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { path: segments } = await context.params;
  const joined = (segments ?? []).join("/");
  const parsed = parseStoragePath(joined);
  if (!parsed) {
    return NextResponse.json({ message: "Caminho inválido." }, { status: 400 });
  }

  // Multi-tenancy enforcement: só super-admin atravessa orgs.
  const sUser = session.user as {
    organizationId?: string | null;
    isSuperAdmin?: boolean;
  };
  const sessionOrgId = sUser.organizationId ?? null;
  const isSuperAdmin = Boolean(sUser.isSuperAdmin);

  if (!isSuperAdmin && sessionOrgId !== parsed.orgId) {
    // 404 (e não 403) pra não confirmar existência.
    return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
  }

  const file = await readStoredFile(parsed.orgId, parsed.bucket, parsed.fileName);
  if (!file) {
    return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
  }

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Cache-Control": "private, max-age=300",
      "Accept-Ranges": "bytes",
      // Hint pra service worker do PWA cachear privadamente.
      "X-Storage-Tenant": parsed.orgId,
    },
  });
}
