import type { AppUserRole } from "@/lib/auth-types";
import {
  getOrgSettingsByPrefix,
  setOrgSettingBool,
} from "@/lib/org-settings";

/**
 * Configuração administrativa que controla se usuários não-ADMIN podem se
 * auto-atribuir conversas sem responsável na caixa de entrada. O ADMIN sempre
 * pode atribuir. Os defaults espelham o comportamento atual (agentes podem
 * pegar conversas livres), mas agora o admin pode desabilitar.
 *
 * Multi-tenancy v0 cutover: antes lia de `SystemSetting` (global, vazava
 * entre tenants). Agora le de `OrganizationSetting` org-scoped + cache.
 */

type SelfAssignRole = "MANAGER" | "MEMBER";

const DEFAULTS: Record<SelfAssignRole, boolean> = {
  MANAGER: true,
  MEMBER: true,
};

async function loadSelfAssignMap(): Promise<Map<string, string>> {
  return getOrgSettingsByPrefix("selfAssign.");
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
  const settings = await loadSelfAssignMap();
  return getFlagForRole(settings, role);
}

export async function getSelfAssignSettings(): Promise<Record<string, boolean>> {
  const settings = await loadSelfAssignMap();
  return {
    ADMIN: true,
    MANAGER: getFlagForRole(settings, "MANAGER"),
    MEMBER: getFlagForRole(settings, "MEMBER"),
  };
}

export async function setSelfAssignForRole(role: SelfAssignRole, enabled: boolean) {
  // setOrgSettingBool ja invalida cache da chave + prefixo.
  await setOrgSettingBool(`selfAssign.${role}`, enabled);
}

/**
 * @deprecated O cache agora é gerenciado em `lib/org-settings.ts`.
 * Mantido como no-op para compatibilidade com chamadas antigas.
 */
export function clearSelfAssignCache() {
  // no-op
}
