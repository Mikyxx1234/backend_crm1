import { Prisma } from "@prisma/client";

import type { AppUserRole } from "@/lib/auth-types";
import { prisma } from "@/lib/prisma";

export type VisibilityMode = "all" | "own";

export type VisibilityResult = {
  canSeeAll: boolean;
  dealWhere: Prisma.DealWhereInput;
  conversationWhere: Prisma.ConversationWhereInput;
};

type SessionUser = { id: string; role: AppUserRole };

const DEFAULTS: Record<AppUserRole, VisibilityMode> = {
  ADMIN: "all",
  MANAGER: "all",
  MEMBER: "own",
};

let settingsCache: Map<string, string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

async function loadSettings(): Promise<Map<string, string>> {
  const now = Date.now();
  if (settingsCache && now - cacheTime < CACHE_TTL) return settingsCache;

  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: "visibility." } },
  });

  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);

  settingsCache = map;
  cacheTime = now;
  return map;
}

export function clearVisibilityCache() {
  settingsCache = null;
  cacheTime = 0;
}

function getModeForRole(
  settings: Map<string, string>,
  role: AppUserRole
): VisibilityMode {
  if (role === "ADMIN") return "all";
  const val = settings.get(`visibility.${role}`);
  if (val === "all" || val === "own") return val;
  return DEFAULTS[role];
}

export async function getVisibilityFilter(
  user: SessionUser
): Promise<VisibilityResult> {
  const role = user.role;

  if (!role || !DEFAULTS[role]) {
    return { canSeeAll: true, dealWhere: {}, conversationWhere: {} };
  }

  const settings = await loadSettings();
  const mode = getModeForRole(settings, role);

  if (mode === "all") {
    return {
      canSeeAll: true,
      dealWhere: {},
      conversationWhere: {},
    };
  }

  return {
    canSeeAll: false,
    dealWhere: { ownerId: user.id },
    /**
     * Inbox: conversa atribuída só ao agente indicado; sem atribuição segue a visibilidade por contato
     * (dono do negócio ou responsável pelo lead).
     */
    conversationWhere: {
      OR: [
        { assignedToId: user.id },
        {
          assignedToId: null,
          contact: {
            OR: [
              { deals: { some: { ownerId: user.id } } },
              { assignedToId: user.id },
            ],
          },
        },
      ],
    },
  };
}

export async function getVisibilitySettings(): Promise<
  Record<string, VisibilityMode>
> {
  const settings = await loadSettings();
  return {
    ADMIN: "all",
    MANAGER: getModeForRole(settings, "MANAGER"),
    MEMBER: getModeForRole(settings, "MEMBER"),
  };
}

export async function setVisibilityForRole(
  role: "MANAGER" | "MEMBER",
  mode: VisibilityMode
) {
  await prisma.systemSetting.upsert({
    where: { key: `visibility.${role}` },
    update: { value: mode },
    create: { key: `visibility.${role}`, value: mode },
  });
  clearVisibilityCache();
}
