import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto de tenant para a request em curso. Populado no inicio do
 * handler (via `withOrgContext`) e propagado pelo AsyncLocalStorage pra
 * dentro de qualquer callback chamado no mesmo "fluxo logico" — Promise
 * chains, setImmediate, setTimeout, streams, etc.
 *
 * Por que AsyncLocalStorage em vez de passar `orgId` como prop?
 * - Nao precisa mudar a assinatura de 300+ funcoes de services/lib.
 * - A Prisma Client Extension precisa ler org sem acesso a `request`.
 * - Codigo em services chamado pelo worker (fora de HTTP) tambem
 *   funciona contanto que tenha sido embrulhado por `withOrgContext`.
 *
 * Limitacoes conhecidas:
 * - Nao atravessa workers (worker_threads) — precisa repassar
 *   explicitamente se algum dia migrarmos pra threads.
 * - Se alguma chamada async usar callback estilo Node (`fn(cb)`) SEM
 *   promise, o contexto se perde. Hoje o codebase eh 100% async/await.
 */

export type RequestContext = {
  /// Id da organizacao atual. Null so em rotas expostas ao super-admin
  /// EduIT (ex.: /admin/organizations lista todas). Rotas scoped devem
  /// exigir nao-null via getOrgIdOrThrow().
  organizationId: string | null;
  /// Id do user atual da sessao — util pra auditoria.
  userId: string;
  /// Flag de super-admin. Habilita bypass da RLS no Postgres quando a
  /// Prisma Extension seta `SET LOCAL app.is_super_admin`.
  isSuperAdmin: boolean;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = storage;

/**
 * Executa `fn` dentro de um contexto com `ctx`. Qualquer chamada
 * async dentro de `fn` consegue ler o contexto via `getRequestContext()`
 * ou `getOrgIdOrThrow()`.
 */
export function runWithContext<T>(
  ctx: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Ativa o contexto para o resto da continuation async atual E para o
 * caller que aguardar a Promise.
 *
 * Comportamento (Node v18+):
 *   - `enterWith()` muda o store atual e PROPAGA pra todas as
 *     continuations descendentes geradas por awaits subsequentes.
 *   - Quando uma async function que chamou `enterWith` retorna, a
 *     Promise resolve mantendo o store ativo — o caller que faz `await`
 *     herda o ctx no frame de continuacao.
 *   - Validado empiricamente em `node test-als.mjs` (24/abr/26).
 *
 * Use casos:
 *   - `requireAuth()` chama `enterRequestContext` apos resolver a
 *     session, populando ctx pra todo o handler que faz
 *     `await requireAuth()`. Isso permite que rotas legadas (sem
 *     `withOrgContext` explicito) funcionem corretamente com a Prisma
 *     extension multi-tenant.
 *   - Webhooks/cron resolvem o ctx a partir do payload e chamam
 *     `enterRequestContext` antes de qualquer prisma.*.
 *
 * Idempotente: so ativa se nao houver ctx ja ativo — `runWithContext`
 * (storage.run) tem precedencia.
 */
export function enterRequestContext(ctx: RequestContext): void {
  if (storage.getStore()) return;
  storage.enterWith(ctx);
}

/** Retorna o contexto atual ou `undefined` se ninguem embrulhou a request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Atalho que explode se nao houver organizationId definido. Use em lugares
 * onde a ausencia e bug (ex.: dentro de service que assume tenant scoped).
 */
export function getOrgIdOrThrow(): string {
  const ctx = storage.getStore();
  if (!ctx?.organizationId) {
    throw new Error(
      "getOrgIdOrThrow: organization context ausente. Esqueceu de envolver o handler em withOrgContext()?",
    );
  }
  return ctx.organizationId;
}

/** Retorna orgId ou null (super-admin). Nao explode. */
export function getOrgIdOrNull(): string | null {
  return storage.getStore()?.organizationId ?? null;
}

/** Retorna a flag super-admin (default false). */
export function isSuperAdminContext(): boolean {
  return Boolean(storage.getStore()?.isSuperAdmin);
}
