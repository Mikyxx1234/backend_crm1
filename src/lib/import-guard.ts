import { NextResponse } from "next/server";

import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import type { AppUserRole } from "@/lib/auth-types";

/**
 * Recursos que podem ser importados em massa via CSV. Cada um exige a
 * permission granular `<resource>:import` (Sprint 1 — Permissions v2).
 */
export type ImportResource = "contact" | "deal" | "product" | "company";

type SessionLike = {
  user?: {
    id?: string;
    organizationId?: string | null;
    role?: AppUserRole | string | null;
    isSuperAdmin?: boolean;
  };
} | null;

/**
 * Guard de importação em massa — usa RBAC granular (v2).
 *
 * Substitui o check legacy baseado em UserRole enum. A decisão fica 100% a
 * cargo do catálogo de permissions: para importar contatos é preciso
 * `contact:import`, para deals `deal:import`, etc. Quem dá/tira essas
 * permissions é o admin via `/settings/permissions`.
 *
 * Retorna:
 *  - 401 quando não há sessão.
 *  - 403 quando o usuário não tem a permission requerida (via
 *    `requirePermissionForUser` — que também respeita overrides por
 *    `scopeGrants.crm.<action>.users` quando aplicável).
 *  - null quando a importação está autorizada.
 *
 * Contrato assíncrono: a checagem consulta `Role.permissions[]` no banco,
 * então toda chamada precisa ser awaitada nas rotas.
 */
export async function assertImportPermission(
  session: SessionLike,
  resource: ImportResource,
): Promise<NextResponse | null> {
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const user = {
    id: session.user.id,
    role: (session.user.role ?? null) as string | null,
    organizationId: session.user.organizationId ?? null,
    isSuperAdmin: Boolean(session.user.isSuperAdmin),
  };

  const permission = `${resource}:import`;
  return requirePermissionForUser(user, permission);
}
