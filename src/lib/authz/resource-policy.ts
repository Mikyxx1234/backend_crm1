import { NextResponse } from "next/server";

import { loadAuthzContext, can, type PermissionKey } from "@/lib/authz";
import {
  canAccessField,
  canAccessScopedResource,
  getScopeGrants,
  readCrmActionGrant,
  type CrmActionKey,
  type ScopeGrants,
} from "@/lib/authz/scope-grants";
import { isFeatureEnabled } from "@/lib/feature-flags";

type UserLike = {
  id: string;
  role?: string | null;
  organizationId: string | null;
  isSuperAdmin?: boolean;
};

/**
 * Mapeamento PermissionKey (RBAC tradicional) → CrmActionKey (toggles
 * por usuário em /settings/permissions).
 *
 * Quando o RBAC nega uma dessas keys, o handler ainda consulta o
 * `scopeGrants.crm.<crmAction>.users[userId]` da org. Se houver override
 * `true`, libera; se houver `false`, mantém o 403; se ausente, mantém o
 * 403 (default deny no backend — mais seguro que o `default true` da lib
 * do frontend, que é só client-side gate).
 *
 * Mantido conservador (29/mai/26): cobre só o que efetivamente quebrava
 * o fluxo do operador. Pra adicionar mais permissões à mesma ação,
 * estender este map — sem precisar tocar o handler.
 */
const RBAC_TO_CRM_ACTION: Partial<Record<PermissionKey, CrmActionKey>> = {
  "deal:change_stage": "editLeads",
  "deal:edit": "editLeads",
  "contact:edit": "editLeads",
  "deal:transfer_owner": "assignOwner",
};

async function userHasCrmActionGrant(
  user: UserLike,
  action: CrmActionKey,
): Promise<boolean> {
  if (!user.organizationId) return false;
  const grants = await getScopeGrants(user.organizationId);
  const value = readCrmActionGrant(grants, action, user.id);
  return value === true;
}

export async function requirePermissionForUser(
  user: UserLike,
  key: PermissionKey,
): Promise<NextResponse | null> {
  const ctx = await loadAuthzContext({
    userId: user.id,
    organizationId: user.organizationId,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  });
  if (can(ctx, key)) return null;

  // Override por usuário via /settings/permissions (UI por toggle).
  // Doc: scope-grants-shared.ts → CrmActionKey. Mapa em RBAC_TO_CRM_ACTION
  // acima. ADMIN nunca cai aqui porque can() já libera tudo pra ele;
  // este path só importa pra MANAGER/MEMBER que ganhou grant explícito.
  const crmAction = RBAC_TO_CRM_ACTION[key];
  if (crmAction && (await userHasCrmActionGrant(user, crmAction))) {
    return null;
  }

  return NextResponse.json({ message: "Acesso negado.", required: key }, { status: 403 });
}

export async function loadScopedPolicy(user: UserLike): Promise<{
  enabled: boolean;
  grants: ScopeGrants;
}> {
  if (!user.organizationId) return { enabled: false, grants: {} };
  const enabled = await isFeatureEnabled("rbac_granular_scope_v1", user.organizationId);
  if (!enabled) return { enabled: false, grants: {} };
  return { enabled: true, grants: await getScopeGrants(user.organizationId) };
}

export async function requirePipelineScope(
  user: UserLike,
  action: "view" | "edit",
  pipelineId: string,
): Promise<NextResponse | null> {
  const policy = await loadScopedPolicy(user);
  if (!policy.enabled) return null;
  const allowed = canAccessScopedResource({
    grants: policy.grants,
    role: user.role,
    resource: "pipeline",
    action,
    targetId: pipelineId,
  });
  if (allowed) return null;
  return NextResponse.json({ message: "Acesso negado ao funil." }, { status: 403 });
}

export async function requireStageScope(
  user: UserLike,
  action: "view" | "edit" | "move",
  stageId: string,
): Promise<NextResponse | null> {
  const policy = await loadScopedPolicy(user);
  if (!policy.enabled) return null;
  const allowed = canAccessScopedResource({
    grants: policy.grants,
    role: user.role,
    resource: "stage",
    action,
    targetId: stageId,
  });
  if (allowed) return null;
  return NextResponse.json({ message: "Acesso negado à etapa." }, { status: 403 });
}

export async function canEditFieldForUser(
  user: UserLike,
  entity: "deal" | "contact" | "product",
  fieldKey: string,
): Promise<boolean> {
  const policy = await loadScopedPolicy(user);
  if (!policy.enabled) return true;
  return canAccessField({
    grants: policy.grants,
    role: user.role,
    entity,
    action: "edit",
    fieldKey,
  });
}

export async function canViewFieldForUser(
  user: UserLike,
  entity: "deal" | "contact" | "product",
  fieldKey: string,
): Promise<boolean> {
  const policy = await loadScopedPolicy(user);
  if (!policy.enabled) return true;
  return canAccessField({
    grants: policy.grants,
    role: user.role,
    entity,
    action: "view",
    fieldKey,
  });
}

