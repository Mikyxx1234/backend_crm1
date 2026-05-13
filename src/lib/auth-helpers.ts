import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";

import { auth } from "./auth";

/**
 * Resultado padronizado das checagens. Quando `ok=false`, devolve
 * direto um `NextResponse` 401/403 que o handler propaga sem precisar
 * decidir nada — reduz boilerplate e garante mesma resposta em todo
 * lugar.
 */
type AuthResult<T> =
  | { ok: true; session: T }
  | { ok: false; response: NextResponse };

/**
 * Session "achatada" — o tipo retornado pelo `auth()` da v5 é uma
 * união grande (middleware/handler/sem args) e a inferência via
 * `ReturnType<typeof auth>` perde a propriedade `user`. Definimos
 * o shape mínimo que usamos e fazemos cast no helper.
 */
type Session = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: UserRole;
    image?: string | null;
  };
};

/**
 * Exige sessão autenticada. Use no topo de qualquer route handler
 * que precise de usuário logado.
 *
 * ```ts
 * export async function GET() {
 *   const r = await requireAuth();
 *   if (!r.ok) return r.response;
 *   const { session } = r;
 *   ...
 * }
 * ```
 */
export async function requireAuth(): Promise<AuthResult<Session>> {
  const session = (await auth()) as Session | null;
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Não autorizado." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, session };
}

function getRole(session: Session): UserRole | null {
  const role = (session.user as { role?: unknown }).role;
  if (role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.MEMBER) {
    return role;
  }
  return null;
}

/**
 * Exige que o usuário tenha um dos roles permitidos. Retorna 403 caso
 * contrário (sessão presente mas sem permissão).
 */
export async function requireRole(
  allowed: UserRole[],
): Promise<AuthResult<Session>> {
  const r = await requireAuth();
  if (!r.ok) return r;
  const role = getRole(r.session);
  if (!role || !allowed.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Acesso negado." },
        { status: 403 },
      ),
    };
  }
  return r;
}

/** Atalho: somente ADMIN. */
export function requireAdmin() {
  return requireRole([UserRole.ADMIN]);
}

/** Atalho: ADMIN ou MANAGER (operações de gestão). */
export function requireManager() {
  return requireRole([UserRole.ADMIN, UserRole.MANAGER]);
}

/** Helper síncrono pra uso em código já com session em mãos. */
export function isAdmin(session: Session | null | undefined): boolean {
  if (!session?.user) return false;
  return getRole(session) === UserRole.ADMIN;
}

export function isManagerOrAdmin(session: Session | null | undefined): boolean {
  if (!session?.user) return false;
  const role = getRole(session);
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}
