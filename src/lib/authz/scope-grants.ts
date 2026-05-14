import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { parseScopeGrants, type ScopeGrants } from "@/lib/authz/scope-grants-shared";

export type { ScopeGrants } from "@/lib/authz/scope-grants-shared";
export {
  canAccessField,
  canAccessScopedResource,
  canSeeInboxTab,
  canSeeSettingsItem,
  canSeeSidebarRoute,
  listAllowedInboxTabsForUser,
  parseScopeGrants,
} from "@/lib/authz/scope-grants-shared";

const SETTINGS_KEY = "permissions.scope.grants.v1";

export async function getScopeGrants(organizationIdArg?: string | null): Promise<ScopeGrants> {
  const organizationId = organizationIdArg ?? getOrgIdOrThrow();
  if (!organizationId) return {};
  const row = await prismaBase.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: SETTINGS_KEY } },
    select: { value: true },
  });
  if (!row?.value) return {};
  try {
    return parseScopeGrants(JSON.parse(row.value));
  } catch {
    return {};
  }
}

export async function setScopeGrants(grants: ScopeGrants): Promise<void> {
  const organizationId = getOrgIdOrThrow();
  await prisma.organizationSetting.upsert({
    where: { organizationId_key: { organizationId, key: SETTINGS_KEY } },
    create: { organizationId, key: SETTINGS_KEY, value: JSON.stringify(parseScopeGrants(grants)) },
    update: { value: JSON.stringify(parseScopeGrants(grants)) },
  });
}
