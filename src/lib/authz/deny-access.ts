/**
 * Helper de negação explícita — Permissions v2 (Sprint 1).
 *
 * Use em controllers quando nenhuma permission de visibilidade está
 * satisfeita e você quer abortar ANTES de chegar ao Prisma. Evita o
 * antipattern de retornar `where: { id: "NEVER" }` (que ainda faz round-
 * trip ao banco e polui logs).
 *
 * Diferença vs `requirePermissionForUser`:
 *  - `requirePermissionForUser` é checagem ATIVA (verifica RBAC + grants).
 *  - `denyAccess` é encerramento PASSIVO — você já decidiu negar.
 *
 * Exemplo:
 *   if (!canSeeAnyDeal(user, grants)) {
 *     return denyAccess("Nenhum filtro de visibilidade satisfeito.");
 *   }
 */
import { NextResponse } from "next/server";

export function denyAccess(reason?: string): NextResponse {
  return NextResponse.json(
    {
      message: "Acesso negado.",
      reason: reason ?? "Sem permissão para este recurso.",
    },
    { status: 403 },
  );
}
