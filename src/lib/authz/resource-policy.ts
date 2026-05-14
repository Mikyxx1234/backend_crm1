import { NextResponse } from "next/server";

import { loadAuthzContext, can, type PermissionKey } from "@/lib/authz";
import {
  canAccessField,
  canAccessScopedResource,
  getScopeGrants,
  type ScopeGrants,
} from "@/lib/authz/scope-grants";
import { isFeatureEnabled } from "@/lib/feature-flags";

type UserLike = {
  id: string;
  role?: string | null;
  organizationId: string | null;
  isSuperAdmin?: boolean;
};

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

