import { NextResponse } from "next/server";

import { logAuditAsync } from "@/lib/audit/log";
import { withOrgContext, requireAuthWithCtx } from "@/lib/auth-helpers";
import { can } from "@/lib/authz";
import { getScopeGrants, setScopeGrants, type ScopeGrants } from "@/lib/authz/scope-grants";
import { getSelfAssignSettings, setSelfAssignForRole } from "@/lib/self-assign";
import {
  getUnassignedSettings,
  getVisibilitySettings,
  setUnassignedForRole,
  setVisibilityForRole,
  type VisibilityMode,
} from "@/lib/visibility";
import { isFeatureEnabled } from "@/lib/feature-flags";

function isVisibilityMode(v: unknown): v is VisibilityMode {
  return v === "all" || v === "own";
}

export async function GET() {
  return withOrgContext(async (session) => {
    const authz = await requireAuthWithCtx();
    if (!authz.ok) return authz.response;

    const role = (session.user as { role?: string }).role ?? null;
    const scopeGrants = await getScopeGrants();
    const visibility = await getVisibilitySettings();
    const unassigned = await getUnassignedSettings();
    const selfAssign = await getSelfAssignSettings();
    const canManage = can(authz.ctx, "settings:permissions");
    const featureEnabled = session.user.organizationId
      ? await isFeatureEnabled("rbac_granular_scope_v1", session.user.organizationId)
      : true;

    return NextResponse.json({
      role,
      canManage,
      permissionKeys: authz.ctx.isAdmin
        ? ["*", ...Array.from(authz.ctx.permissions)]
        : Array.from(authz.ctx.permissions),
      featureEnabled,
      visibility,
      unassigned,
      selfAssign,
      scopeGrants,
    });
  });
}

export async function PUT(request: Request) {
  return withOrgContext(async () => {
    const authz = await requireAuthWithCtx();
    if (!authz.ok) return authz.response;
    if (!can(authz.ctx, "settings:permissions")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const visibility = body.visibility;
    if (visibility && typeof visibility === "object") {
      const v = visibility as Record<string, unknown>;
      if (v.MANAGER !== undefined) {
        if (!isVisibilityMode(v.MANAGER)) {
          return NextResponse.json({ message: "visibility.MANAGER inválido." }, { status: 400 });
        }
        await setVisibilityForRole("MANAGER", v.MANAGER);
      }
      if (v.MEMBER !== undefined) {
        if (!isVisibilityMode(v.MEMBER)) {
          return NextResponse.json({ message: "visibility.MEMBER inválido." }, { status: 400 });
        }
        await setVisibilityForRole("MEMBER", v.MEMBER);
      }
    }

    const unassigned = body.unassigned;
    if (unassigned && typeof unassigned === "object") {
      const u = unassigned as Record<string, unknown>;
      if (u.MANAGER !== undefined) {
        if (typeof u.MANAGER !== "boolean") {
          return NextResponse.json({ message: "unassigned.MANAGER inválido." }, { status: 400 });
        }
        await setUnassignedForRole("MANAGER", u.MANAGER);
      }
      if (u.MEMBER !== undefined) {
        if (typeof u.MEMBER !== "boolean") {
          return NextResponse.json({ message: "unassigned.MEMBER inválido." }, { status: 400 });
        }
        await setUnassignedForRole("MEMBER", u.MEMBER);
      }
    }

    const selfAssign = body.selfAssign;
    if (selfAssign && typeof selfAssign === "object") {
      const s = selfAssign as Record<string, unknown>;
      if (s.MANAGER !== undefined) {
        if (typeof s.MANAGER !== "boolean") {
          return NextResponse.json({ message: "selfAssign.MANAGER inválido." }, { status: 400 });
        }
        await setSelfAssignForRole("MANAGER", s.MANAGER);
      }
      if (s.MEMBER !== undefined) {
        if (typeof s.MEMBER !== "boolean") {
          return NextResponse.json({ message: "selfAssign.MEMBER inválido." }, { status: 400 });
        }
        await setSelfAssignForRole("MEMBER", s.MEMBER);
      }
    }

    if (body.scopeGrants !== undefined) {
      const beforeGrants = await getScopeGrants();
      await setScopeGrants((body.scopeGrants ?? {}) as ScopeGrants);
      const afterGrants = await getScopeGrants();
      // Bloco E (25/jun/26): auditoria do bulk update (PUT global da org).
      // before/after são objetos grandes — redactValue do logAudit lida
      // com chaves sensíveis; aqui o conteúdo é só IDs/listas, sem PII.
      logAuditAsync({
        entity: "settings",
        action: "permission.scope.update",
        entityId: null,
        before: beforeGrants,
        after: afterGrants,
        metadata: { target: "org-bulk" },
      });
    }

    return NextResponse.json({
      ok: true,
      visibility: await getVisibilitySettings(),
      unassigned: await getUnassignedSettings(),
      selfAssign: await getSelfAssignSettings(),
      scopeGrants: await getScopeGrants(),
    });
  });
}

