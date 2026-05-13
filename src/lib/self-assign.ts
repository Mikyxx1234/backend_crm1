import type { AppUserRole } from "@/lib/auth-types";
import { prisma } from "@/lib/prisma";

/**
 * Configuração administrativa que controla se usuários não-ADMIN podem se
 * auto-atribuir conversas sem responsável na caixa de entrada. O ADMIN sempre
 * pode atribuir. Os defaults espelham o comportamento atual (agentes podem
 * pegar conversas livres), mas agora o admin pode desabilitar.
 */

type SelfAssignRole = "MANAGER" | "MEMBER";

const DEFAULTS: Record<SelfAssignRole, boolean> = {
  MANAGER: true,
  MEMBER: true,
};

let cache: Map<string, string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

async function loadSettings(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return cache;

  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: "selfAssign." } },
  });

  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);

  cache = map;
  cacheTime = now;
  return map;
}

export function clearSelfAssignCache() {
  cache = null;
  cacheTime = 0;
}

function getFlagForRole(settings: Map<string, string>, role: SelfAssignRole): boolean {
  const val = settings.get(`selfAssign.${role}`);
  if (val === "true") return true;
  if (val === "false") return false;
  return DEFAULTS[role];
}

export async function canRoleSelfAssign(role: AppUserRole | undefined | null): Promise<boolean> {
  if (!role) return false;
  if (role === "ADMIN") return true;
  const settings = await loadSettings();
  return getFlagForRole(settings, role);
}

export async function getSelfAssignSettings(): Promise<Record<string, boolean>> {
  const settings = await loadSettings();
  return {
    ADMIN: true,
    MANAGER: getFlagForRole(settings, "MANAGER"),
    MEMBER: getFlagForRole(settings, "MEMBER"),
  };
}

export async function setSelfAssignForRole(role: SelfAssignRole, enabled: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: `selfAssign.${role}` },
    update: { value: enabled ? "true" : "false" },
    create: { key: `selfAssign.${role}`, value: enabled ? "true" : "false" },
  });
  clearSelfAssignCache();
}
