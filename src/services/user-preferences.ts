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

/** Le a preferencia bruta de sidebar salva (ou null se nunca salvou). */
async function readRawSidebar(
  userId: string,
): Promise<SidebarItemPreference[] | null> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { sidebar: true },
  });
  const sidebar = pref?.sidebar as { items?: unknown } | null | undefined;
  if (!sidebar || !Array.isArray(sidebar.items)) return null;
  return sidebar.items as SidebarItemPreference[];
}

/**
 * Retorna a preferencia de sidebar do usuario, ja normalizada contra o
 * catalogo atual. Se o usuario nunca salvou, devolve o padrao.
 */
export async function getSidebarPreferences(
  userId: string,
  availableKeys: Set<string> = computeAvailableKeys(),
): Promise<SidebarPreferences> {
  const raw = await readRawSidebar(userId);
  return normalizeSidebar(raw ?? [], availableKeys);
}

/**
 * Salva (upsert) a preferencia de sidebar do usuario. O input e normalizado
 * antes de persistir; retorna a versao final normalizada.
 */
export async function saveSidebarPreferences(
  userId: string,
  inputItems: SidebarItemPreference[],
  availableKeys: Set<string> = computeAvailableKeys(),
): Promise<SidebarPreferences> {
  const normalized = normalizeSidebar(inputItems, availableKeys);
  const sidebarJson = normalized as unknown as Prisma.InputJsonValue;

  await prisma.userPreference.upsert({
    where: { userId },
    update: { sidebar: sidebarJson },
    create: { userId, sidebar: sidebarJson },
  });

  return normalized;
}

/** Restaura o padrao (catalogo, todos habilitados). Persiste e retorna. */
export async function resetSidebarPreferences(
  userId: string,
  availableKeys: Set<string> = computeAvailableKeys(),
): Promise<SidebarPreferences> {
  return saveSidebarPreferences(userId, [], availableKeys);
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
