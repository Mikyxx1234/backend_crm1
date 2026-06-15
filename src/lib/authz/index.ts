/**
 * Authz core — `can`, `permissionsOf`, `requirePermission`.
 *
 * Modelo (Fase 1 Foundation):
 *   - User pode ter N Roles (M:N via `UserRoleAssignment`).
 *   - Cada Role tem `permissions: string[]` (chaves do catalogo).
 *   - Permissions efetivas do user = uniao das permissions de todos os
 *     roles atribuidos a ele NA ORGANIZACAO ATUAL.
 *   - Wildcards: "*" = todas; "<resource>:*" = todas as actions do recurso.
 *
 * Performance:
 *   - Hot path `can(ctx, key)` e O(1) via `Set.has`. A construcao do
 *     Set vem do banco mas e cacheada via `cache.wrap` (TTL 60s + lock
 *     anti-stampede). Mutations chamam `invalidateAuthzForUser(userId)`
 *     pra zerar a cache imediatamente.
 *
 * Super-admin EduIT:
 *   - `isSuperAdmin=true` bypassa qualquer checagem (retorna true sempre).
 *   - Mesmo padrao do RLS Postgres (BYPASSRLS no role).
 *
 * Tenant isolation:
 *   - permissions vem so de roles da organizationId do user. Nunca
 *     cruzamos org. Defesa em profundidade: RLS ja impede leak
 *     (`roles.organizationId = current_setting(...)`).
 *
 * Lockout impossivel:
 *   - Se um admin acidentalmente esvaziar `permissions` do preset ADMIN,
 *     `can(adminCtx, anything)` retornaria false. Pra prevenir, `can`
 *     SEMPRE retorna true se o user tem algum role com `systemPreset
 *     === "ADMIN"` — esse e o "kill switch" de seguranca. Detalhes em
 *     `loadAuthzContext`. Validacao adicional na UI (nao deixa salvar
 *     ADMIN com permissions vazias) e no service de update de Role.
 */

import { NextResponse } from "next/server";
import { UserRole, type UserRole as UserRoleEnum } from "@prisma/client";

import { cache } from "@/lib/cache";
import { getLogger } from "@/lib/logger";
import { prismaBase } from "@/lib/prisma-base";

import { isValidPermissionKey, type PermissionKey } from "./permissions";
import { PRESET_PERMISSIONS } from "./presets";

const log = getLogger("authz");

const CACHE_PREFIX = "authz:user:";
const CACHE_TTL_SEC = 60;

// ──────────────────────────────────────────────
// Tipos publicos
// ──────────────────────────────────────────────

/**
 * Contexto leve de authz, derivado de uma sessao. Usado pra checagens
 * em hot paths (rotas, server components, sidebar). Conter `Set` direto
 * em vez de array torna `can()` O(1).
 *
 * `isAdmin` aqui e o kill switch — true sempre que o user tem algum
 * role `systemPreset="ADMIN"` (independente das permissions do preset).
 */
export type ScopeLevel = "NONE" | "SELF" | "TEAM" | "ALL";

/**
 * Mapa de escopos vindos de GRUPOS: resource -> action -> maior nivel
 * concedido entre os grupos do user. Dirige a visibilidade (own/all) no
 * enforcement das rotas de dados. Aditivo ao RBAC de papeis.
 */
export type GroupScopeMap = Record<string, Record<string, ScopeLevel>>;

const LEVEL_RANK: Record<ScopeLevel, number> = {
  NONE: 0,
  SELF: 1,
  TEAM: 2,
  ALL: 3,
};

export interface AuthzContext {
  userId: string;
  organizationId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  permissions: ReadonlySet<string>;
  /** Escopos vindos de grupos (resource -> action -> nivel). */
  scopes: GroupScopeMap;
}

/**
 * Versao serializavel do contexto pra cache (Set -> Array).
 */
interface CachedAuthzPayload {
  organizationId: string | null;
  isAdmin: boolean;
  permissions: string[];
  scopes: GroupScopeMap;
}

// ──────────────────────────────────────────────
// Carregamento + cache
// ──────────────────────────────────────────────

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`;
}

/**
 * Le os roles + permissions do user direto do banco. Usa prismaBase
 * (sem RLS) porque pode rodar fora de RequestContext (ex.: middleware
 * ou hot-path antes do scope estar configurado). A query restringe
 * por organizationId pra defesa em profundidade.
 */
const LEGACY_ROLES = new Set<UserRoleEnum>([
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.MEMBER,
]);

/**
 * Fallback quando `user_role_assignments` está vazio (org criada após
 * signup sem seed, migration não rodada, ou bug antigo no POST /users).
 * Usa `User.role` legado + preset da org (ou constante TS) pra não
 * barrar operação em produção — DNA e demais orgs continuam funcionando.
 */
async function applyLegacyRoleFallback(
  userId: string,
  organizationId: string,
  merged: Set<string>,
  isAdmin: boolean,
): Promise<{ permissions: Set<string>; isAdmin: boolean }> {
  if (merged.size > 0 || isAdmin) {
    return { permissions: merged, isAdmin };
  }

  const user = await prismaBase.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const legacy = user?.role;
  if (!legacy || !LEGACY_ROLES.has(legacy)) {
    return { permissions: merged, isAdmin };
  }

  if (legacy === UserRole.ADMIN) {
    return { permissions: merged, isAdmin: true };
  }

  const presetRow = await prismaBase.role.findFirst({
    where: { organizationId, systemPreset: legacy },
    select: { permissions: true },
  });
  const source = presetRow?.permissions?.length
    ? presetRow.permissions
    : [...PRESET_PERMISSIONS[legacy]];

  for (const p of source) {
    if (isValidPermissionKey(p)) merged.add(p);
  }
  return { permissions: merged, isAdmin };
}

async function loadFromDb(
  userId: string,
  organizationId: string,
): Promise<CachedAuthzPayload> {
  const assignments = await prismaBase.userRoleAssignment.findMany({
    where: { userId, organizationId },
    select: {
      role: {
        select: {
          systemPreset: true,
          permissions: true,
        },
      },
    },
  });

  const merged = new Set<string>();
  let isAdmin = false;
  for (const a of assignments) {
    if (a.role.systemPreset === "ADMIN") isAdmin = true;
    for (const p of a.role.permissions) {
      if (isValidPermissionKey(p)) merged.add(p);
    }
  }

  // Grupos (modelo Kommo) — aditivo aos papeis. Uma permissao com nivel
  // >= SELF concede a key booleana (faz `can()` passar); o nivel fica no
  // mapa `scopes` pra dirigir own/all no enforcement de visibilidade.
  const groupMemberships = await prismaBase.groupMember.findMany({
    where: { userId, organizationId },
    select: {
      group: {
        select: {
          permissions: { select: { resource: true, action: true, level: true } },
        },
      },
    },
  });

  const scopes: GroupScopeMap = {};
  for (const gm of groupMemberships) {
    for (const p of gm.group.permissions) {
      const level = p.level as ScopeLevel;
      if (level === "NONE") continue;
      const key = `${p.resource}:${p.action}`;
      if (!isValidPermissionKey(key)) continue;
      merged.add(key);
      const byAction = (scopes[p.resource] ??= {});
      const current = byAction[p.action];
      if (!current || LEVEL_RANK[level] > LEVEL_RANK[current]) {
        byAction[p.action] = level;
      }
    }
  }

  const fallback = await applyLegacyRoleFallback(
    userId,
    organizationId,
    merged,
    isAdmin,
  );

  return {
    organizationId,
    isAdmin: fallback.isAdmin,
    permissions: Array.from(fallback.permissions),
    scopes,
  };
}

/**
 * Constroi o AuthzContext a partir de uma sessao minima. E o ponto de
 * entrada pra todo callsite que precisa consultar permissions.
 *
 * Performance: cache.wrap com stampede protection. Se o user tem 5
 * roles, ainda e UMA query por TTL.
 *
 * Super-admin EduIT: retorna shortcut sem tocar no banco — eles
 * bypassam authz inteiramente (`isSuperAdmin=true`, `isAdmin=true`,
 * permissions vazia mas `can` ja retorna true antes de checar).
 */
export async function loadAuthzContext(input: {
  userId: string;
  organizationId: string | null;
  isSuperAdmin: boolean;
}): Promise<AuthzContext> {
  if (input.isSuperAdmin) {
    return {
      userId: input.userId,
      organizationId: input.organizationId,
      isSuperAdmin: true,
      isAdmin: true,
      permissions: new Set(),
      scopes: {},
    };
  }

  if (!input.organizationId) {
    // User sem org e sem super-admin = estado invalido. Retorna
    // contexto vazio pra que toda checagem falhe (fail-closed).
    log.warn({ userId: input.userId }, "[authz] user sem organizationId — contexto vazio");
    return {
      userId: input.userId,
      organizationId: null,
      isSuperAdmin: false,
      isAdmin: false,
      permissions: new Set(),
      scopes: {},
    };
  }

  const orgId = input.organizationId;
  const payload = await cache.wrap<CachedAuthzPayload>(
    cacheKey(input.userId),
    CACHE_TTL_SEC,
    () => loadFromDb(input.userId, orgId),
  );

  return {
    userId: input.userId,
    organizationId: payload.organizationId,
    isSuperAdmin: false,
    isAdmin: payload.isAdmin,
    permissions: new Set(payload.permissions),
    scopes: payload.scopes ?? {},
  };
}

// ──────────────────────────────────────────────
// Escopos de grupo (own/all) — usado no enforcement de visibilidade
// ──────────────────────────────────────────────

/** Nivel de escopo concedido por grupos para `resource:action` (default NONE). */
export function groupScopeOf(
  ctx: AuthzContext,
  resource: string,
  action: string,
): ScopeLevel {
  return ctx.scopes?.[resource]?.[action] ?? "NONE";
}

/**
 * Visibilidade que os GRUPOS concedem para um recurso (dirigida pela action
 * "view"). Aditivo: retorna "all" se algum grupo dá ALL/TEAM no view, "own"
 * se o maior nivel de view é SELF, ou null se nenhum grupo opina (deixa o
 * RBAC de papel/legacy decidir). TEAM é tratado como "all" por ora (sem
 * estrutura de times — nivel reservado, não selecionável na UI).
 */
export function groupResourceVisibility(
  ctx: AuthzContext,
  resource: string,
): "all" | "own" | null {
  const byAction = ctx.scopes?.[resource];
  if (!byAction) return null;
  const viewLevel = byAction["view"];
  if (!viewLevel || viewLevel === "NONE") return null;
  if (viewLevel === "SELF") return "own";
  return "all";
}

// ──────────────────────────────────────────────
// Verificacao
// ──────────────────────────────────────────────

/**
 * Sync — checa uma permission contra um contexto ja carregado. Hot path.
 *
 * Ordem de checagem (curto-circuito):
 *   1. Super-admin EduIT → true (bypass total).
 *   2. Preset ADMIN → true (kill switch — preserva acesso mesmo se
 *      permissions do preset foram corrompidas).
 *   3. Permissao "*" presente → true.
 *   4. Permissao exata `<resource>:<action>` → true.
 *   5. Permissao wildcard `<resource>:*` → true.
 *   6. Caso contrario → false.
 */
export function can(ctx: AuthzContext, key: PermissionKey): boolean {
  if (ctx.isSuperAdmin) return true;
  if (ctx.isAdmin) return true;
  if (ctx.permissions.has("*")) return true;
  if (ctx.permissions.has(key)) return true;
  const colonIdx = key.indexOf(":");
  if (colonIdx > 0) {
    const resourceWildcard = `${key.slice(0, colonIdx)}:*`;
    if (ctx.permissions.has(resourceWildcard)) return true;
  }
  return false;
}

/**
 * Sync — checa se o user tem TODAS as permissions listadas. AND.
 */
export function canAll(ctx: AuthzContext, keys: PermissionKey[]): boolean {
  return keys.every((k) => can(ctx, k));
}

/**
 * Sync — checa se o user tem PELO MENOS UMA das permissions. OR.
 */
export function canAny(ctx: AuthzContext, keys: PermissionKey[]): boolean {
  return keys.some((k) => can(ctx, k));
}

/**
 * Async — atalho pra callsites que ainda nao carregaram contexto.
 * Cuidado: faz IO. Em hot paths, prefira passar o `AuthzContext`.
 */
export async function checkPermission(
  input: { userId: string; organizationId: string | null; isSuperAdmin: boolean },
  key: PermissionKey,
): Promise<boolean> {
  const ctx = await loadAuthzContext(input);
  return can(ctx, key);
}

// ──────────────────────────────────────────────
// Helper de rota — composto com requireAuth
// ──────────────────────────────────────────────

/**
 * Devolve `null` se OK, ou `NextResponse` 401/403 caso contrario.
 *
 * Uso tipico:
 *   const r = await requireAuth();
 *   if (!r.ok) return r.response;
 *   const denied = await requirePermission(r.session.user, "pipeline:edit");
 *   if (denied) return denied;
 *
 * Vamos ter um wrapper de mais alto nivel em fase 2 que combina os dois,
 * mas por enquanto mantemos atomicos pra reaproveitar `requireAuth`.
 */
export async function requirePermission(
  user: { id: string; organizationId: string | null; isSuperAdmin: boolean },
  key: PermissionKey,
): Promise<NextResponse | null> {
  const ctx = await loadAuthzContext({
    userId: user.id,
    organizationId: user.organizationId,
    isSuperAdmin: user.isSuperAdmin,
  });
  if (can(ctx, key)) return null;
  return NextResponse.json(
    { message: "Acesso negado.", required: key },
    { status: 403 },
  );
}

// ──────────────────────────────────────────────
// Invalidation (chamada em mutacoes de Role/UserRoleAssignment)
// ──────────────────────────────────────────────

/**
 * Invalida cache de authz de um user especifico. Chame em:
 *   - Apos atribuir/remover Role do user (UserRoleAssignment.create/delete).
 *   - Apos editar permissions de uma Role (em fase 2 vai invalidar TODOS
 *     os users com essa Role — usar `invalidateAuthzForOrg` ou
 *     `invalidateAuthzForRole`).
 */
export async function invalidateAuthzForUser(userId: string): Promise<void> {
  await cache.del(cacheKey(userId));
}

/**
 * Invalida cache de TODOS os users de uma org. Chame quando alterar
 * permissions de uma Role (afeta todos os assignments). Mais barato que
 * iterar por user ID porque usa `delPattern` em SCAN batch.
 *
 * Nota: usa pattern global (`authz:user:*`) — em deploys multi-org no
 * mesmo Redis, isso invalida users de OUTRAS orgs tambem. Aceitavel
 * porque cache e re-construido lazy no proximo hit. Se virar gargalo,
 * trocar pra namespacing por org (`authz:org:<id>:user:<id>`).
 */
export async function invalidateAuthzForOrg(_organizationId: string): Promise<void> {
  await cache.delPattern("authz:user:*");
}

/**
 * Re-export tipos pra ergonomia do callsite.
 */
export type { PermissionKey } from "./permissions";

/**
 * Compat helper: traduz UserRole enum -> systemPreset string.
 * Mantido aqui pra centralizar a conversao usada em todos os callsites
 * legados que ainda comparam `user.role === "ADMIN"`.
 */
export function isPresetAdmin(role: UserRole | null | undefined): boolean {
  return role === "ADMIN";
}
