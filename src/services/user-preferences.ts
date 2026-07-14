/**
 * Service de preferencias pessoais do usuario.
 *
 * Escopo: POR USUARIO (nunca por organizacao). O `userId` vem SEMPRE da
 * sessao (caller passa session.user.id) — nunca do body. O modelo
 * `UserPreference` NAO esta em SCOPED_MODELS, entao a Prisma Extension nao
 * injeta organizationId; filtramos por userId explicitamente.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { PermissionKey } from "@/lib/authz";
import {
  SIDEBAR_CATALOG,
  SIDEBAR_KEYS,
  SIDEBAR_LOCKED_KEYS,
} from "@/lib/sidebar-catalog";
import {
  DASHBOARD_BLOCKS_CATALOG,
  DASHBOARD_BLOCK_KEYS,
  DASHBOARD_LOCKED_BLOCK_KEYS,
} from "@/lib/dashboard-blocks-catalog";

export interface SidebarItemPreference {
  key: string;
  enabled: boolean;
  order: number;
}

export interface SidebarPreferences {
  items: SidebarItemPreference[];
}

/**
 * Conjunto de keys disponiveis para o usuario.
 *
 * Um item entra em `availableKeys` somente se:
 *  - nao exige permission, OU o `hasPermission` confirma a permission; E
 *  - nao exige widget, OU o `hasWidget` confirma o widget ATIVO na org.
 *
 * Sem predicados, itens gateados (com `requiredPermission`/`requiredWidgetSlug`)
 * ficam de fora — fail-closed. O caller (rota) injeta os predicados a partir
 * do authz (`can`) e do estado de widgets da org (`getActiveWidgetSlugs`).
 */
export function computeAvailableKeys(
  hasPermission?: (key: PermissionKey) => boolean,
  hasWidget?: (slug: string) => boolean,
): Set<string> {
  return new Set(
    SIDEBAR_CATALOG.filter((i) => {
      const permOk =
        !i.requiredPermission || (hasPermission?.(i.requiredPermission) ?? false);
      const widgetOk =
        !i.requiredWidgetSlug || (hasWidget?.(i.requiredWidgetSlug) ?? false);
      return permOk && widgetOk;
    }).map((i) => i.key),
  );
}

/**
 * Normaliza uma lista de itens (vinda do banco ou do body) contra o
 * catalogo + permissoes, aplicando todas as regras:
 *  - remove keys desconhecidas / sem permissao;
 *  - mantem a ordem salva para itens conhecidos;
 *  - anexa, ao final, itens novos do catalogo que ainda nao estavam salvos
 *    (como enabled = true);
 *  - forca itens `locked` a ficarem enabled;
 *  - reescreve `order` sequencialmente (1..N).
 */
export function normalizeSidebar(
  rawItems: SidebarItemPreference[],
  availableKeys: Set<string> = computeAvailableKeys(),
): SidebarPreferences {
  const savedMap = new Map<string, SidebarItemPreference>();
  for (const it of rawItems) {
    if (!it || typeof it.key !== "string") continue;
    if (!availableKeys.has(it.key)) continue; // desconhecida / sem permissao
    if (savedMap.has(it.key)) continue; // dedup
    savedMap.set(it.key, it);
  }

  // Ordem: primeiro os salvos (pela order salva), depois novos do catalogo.
  const orderedKeys = [...savedMap.values()]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((it) => it.key);

  for (const item of SIDEBAR_CATALOG) {
    if (availableKeys.has(item.key) && !orderedKeys.includes(item.key)) {
      orderedKeys.push(item.key);
    }
  }

  const items: SidebarItemPreference[] = orderedKeys.map((key, idx) => {
    const locked = SIDEBAR_LOCKED_KEYS.has(key);
    const saved = savedMap.get(key);
    return {
      key,
      enabled: locked ? true : (saved?.enabled ?? true),
      order: idx + 1,
    };
  });

  return { items };
}

/**
 * Le todos os `sidebarItems` dos Roles atribuidos ao usuario. A sidebar
 * efetiva do usuario e' derivada aqui — a decisao (14/jul/26) foi mover
 * essa preferencia de UserPreference (per-user) para Role (per-papel),
 * gerenciada pelo admin em /settings/permissions. Ver AGENT.md.
 *
 * Retorna array de "layers" (uma por role com sidebarItems nao-null),
 * cada layer preservando a ordem original salva. `mergeSidebarLayers`
 * faz a UNIAO (aditivo). Se nenhum role tem sidebarItems configurado,
 * retorna array vazio -> cai no default do catalogo.
 */
async function readRoleSidebarLayers(
  userId: string,
): Promise<SidebarItemPreference[][]> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId },
    select: {
      role: { select: { id: true, sidebarItems: true, createdAt: true } },
    },
    // Ordem estavel = primeiro role atribuido tem prioridade de ordem quando
    // aparece uma key nova; mais roles apenas adicionam itens ao final.
    orderBy: { role: { createdAt: "asc" } },
  });

  const layers: SidebarItemPreference[][] = [];
  for (const a of assignments) {
    const raw = a.role?.sidebarItems as { items?: unknown } | unknown[] | null | undefined;
    if (!raw) continue;
    // O admin salva no shape { items: [...] } (mesmo do UserPreference antigo)
    // mas aceitamos array cru para tolerar edicoes manuais no banco.
    const items = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { items?: unknown }).items)
        ? (raw as { items: unknown[] }).items
        : null;
    if (!items) continue;
    layers.push(items as SidebarItemPreference[]);
  }
  return layers;
}

/**
 * UNIAO das preferencias de multiplos roles: um item aparece habilitado
 * se QUALQUER role o habilitou (padrao aditivo, alinhado com scope de
 * canais). Ordem = primeira ocorrencia entre os layers (roles mais antigos
 * ditam a ordem; layers posteriores apenas anexam novos itens).
 */
function mergeSidebarLayers(
  layers: SidebarItemPreference[][],
): SidebarItemPreference[] {
  if (layers.length === 0) return [];
  const seenOrder: string[] = [];
  const enabledAny = new Map<string, boolean>();
  for (const layer of layers) {
    const sorted = [...layer]
      .filter((it) => it && typeof it.key === "string")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const it of sorted) {
      if (!seenOrder.includes(it.key)) seenOrder.push(it.key);
      // OR aditivo: uma vez habilitado em qualquer role, permanece habilitado.
      enabledAny.set(it.key, (enabledAny.get(it.key) ?? false) || !!it.enabled);
    }
  }
  return seenOrder.map((key, idx) => ({
    key,
    enabled: enabledAny.get(key) ?? true,
    order: idx + 1,
  }));
}

/**
 * Retorna a preferencia de sidebar do usuario, ja normalizada contra o
 * catalogo atual. Fonte: uniao dos `sidebarItems` de todos os roles do
 * usuario. Se nenhum role tem override, devolve o padrao do catalogo.
 */
export async function getSidebarPreferences(
  userId: string,
  availableKeys: Set<string> = computeAvailableKeys(),
): Promise<SidebarPreferences> {
  const layers = await readRoleSidebarLayers(userId);
  const merged = mergeSidebarLayers(layers);
  return normalizeSidebar(merged, availableKeys);
}

/**
 * Salva `sidebarItems` num Role especifico. Chamado pelo endpoint de admin
 * (/api/roles/[id]) — o usuario comum nao pode mais editar a propria sidebar.
 * Normaliza contra o catalogo antes de persistir e retorna a versao final.
 */
export async function saveRoleSidebarItems(
  roleId: string,
  inputItems: SidebarItemPreference[],
  availableKeys: Set<string> = computeAvailableKeys(),
): Promise<SidebarPreferences> {
  const normalized = normalizeSidebar(inputItems, availableKeys);
  const sidebarJson = normalized as unknown as Prisma.InputJsonValue;
  await prisma.role.update({
    where: { id: roleId },
    data: { sidebarItems: sidebarJson },
  });
  return normalized;
}

// ── Dashboard (layout dos blocos de analise) ───────────────────────────
// Mesmo escopo/regras da sidebar: por usuario, normalizado contra o
// catalogo de blocos. Shape persistido: { blocks: [{ key, enabled, order }] }.

export interface DashboardBlockPreference {
  key: string;
  enabled: boolean;
  order: number;
}

export interface DashboardPreferences {
  blocks: DashboardBlockPreference[];
}

/**
 * Normaliza a lista de blocos (do banco ou do body) contra o catalogo:
 *  - remove keys desconhecidas;
 *  - mantem a ordem salva para blocos conhecidos;
 *  - anexa, ao final, blocos novos do catalogo ainda nao salvos (enabled);
 *  - forca blocos `locked` a ficarem enabled;
 *  - reescreve `order` sequencialmente (1..N).
 */
export function normalizeDashboard(
  rawBlocks: DashboardBlockPreference[],
): DashboardPreferences {
  const savedMap = new Map<string, DashboardBlockPreference>();
  for (const it of rawBlocks) {
    if (!it || typeof it.key !== "string") continue;
    if (!DASHBOARD_BLOCK_KEYS.has(it.key)) continue;
    if (savedMap.has(it.key)) continue;
    savedMap.set(it.key, it);
  }

  const orderedKeys = [...savedMap.values()]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((it) => it.key);

  for (const block of DASHBOARD_BLOCKS_CATALOG) {
    if (!orderedKeys.includes(block.key)) orderedKeys.push(block.key);
  }

  const blocks: DashboardBlockPreference[] = orderedKeys.map((key, idx) => {
    const locked = DASHBOARD_LOCKED_BLOCK_KEYS.has(key);
    const saved = savedMap.get(key);
    return {
      key,
      enabled: locked ? true : (saved?.enabled ?? true),
      order: idx + 1,
    };
  });

  return { blocks };
}

async function readRawDashboard(
  userId: string,
): Promise<DashboardBlockPreference[] | null> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { dashboard: true },
  });
  const dashboard = pref?.dashboard as { blocks?: unknown } | null | undefined;
  if (!dashboard || !Array.isArray(dashboard.blocks)) return null;
  return dashboard.blocks as DashboardBlockPreference[];
}

/** Preferencia de layout do dashboard, normalizada. Padrao se nunca salvou. */
export async function getDashboardPreferences(
  userId: string,
): Promise<DashboardPreferences> {
  const raw = await readRawDashboard(userId);
  return normalizeDashboard(raw ?? []);
}

/** Salva (upsert) o layout do dashboard. Normaliza antes de persistir. */
export async function saveDashboardPreferences(
  userId: string,
  inputBlocks: DashboardBlockPreference[],
): Promise<DashboardPreferences> {
  const normalized = normalizeDashboard(inputBlocks);
  const dashboardJson = normalized as unknown as Prisma.InputJsonValue;

  await prisma.userPreference.upsert({
    where: { userId },
    update: { dashboard: dashboardJson },
    create: { userId, dashboard: dashboardJson },
  });

  return normalized;
}

export { SIDEBAR_KEYS };
