import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  canEditFieldForUser,
  loadScopedPolicy,
  requirePermissionForUser,
} from "@/lib/authz/resource-policy";
import { canAccessField } from "@/lib/authz/scope-grants";
import { prisma } from "@/lib/prisma";
import {
  getDealCustomFieldValues,
  upsertDealCustomFieldValues,
} from "@/services/custom-fields";
import { createDealEvent, getDealById } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "deal:view",
      );
      if (denied) return denied;
      const { id } = await ctx.params;
      const existing = await getDealById(id);
      if (!existing) return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
      const values = await getDealCustomFieldValues(existing.id);
      const user = session.user as {
        id: string;
        organizationId: string | null;
        role?: string | null;
        isSuperAdmin?: boolean;
      };
      // Uma única carga de policy por request — antes: `canViewFieldForUser`
      // chamava `loadScopedPolicy` por campo (N round-trips), o que podia
      // deixar a rota lenta ou parecer “travada” no cliente.
      const policy = await loadScopedPolicy(user);
      const visible = values.filter((item) => {
        if (!policy.enabled) return true;
        return canAccessField({
          grants: policy.grants,
          role: user.role,
          entity: "deal",
          action: "view",
          fieldKey: item.fieldId,
        });
      });
      return NextResponse.json(visible);
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "deal:edit",
      );
      if (denied) return denied;
      const { id } = await ctx.params;
      const existing = await getDealById(id);
      if (!existing) return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
      const dealId = existing.id;
      const body = (await request.json()) as Record<string, unknown>;
      const values = Array.isArray(body.values) ? body.values : [];
      const cleaned = values
        .filter(
          (v): v is { fieldId: string; value: string } =>
            typeof v === "object" &&
            v !== null &&
            typeof (v as Record<string, unknown>).fieldId === "string" &&
            typeof (v as Record<string, unknown>).value === "string"
        );
      const blocked = [];
      for (const item of cleaned) {
        const allowed = await canEditFieldForUser(
          session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
          "deal",
          item.fieldId,
        );
        if (!allowed) blocked.push(item.fieldId);
      }
      if (blocked.length > 0) {
        return NextResponse.json(
          { message: "Sem permissão para editar alguns campos.", blockedFieldIds: blocked },
          { status: 403 },
        );
      }
      const oldValues = await getDealCustomFieldValues(dealId);
      await upsertDealCustomFieldValues(dealId, cleaned);
      const updated = await getDealCustomFieldValues(dealId);

      const uid = (session.user as { id: string }).id;
      const fieldIds = cleaned.map((c) => c.fieldId);
      const fieldDefs = await prisma.customField.findMany({
        where: { id: { in: fieldIds } },
        select: { id: true, label: true },
      });
      const labelMap = new Map(fieldDefs.map((f) => [f.id, f.label]));
      const oldMap = new Map((oldValues as { fieldId: string; value: string }[]).map((v) => [v.fieldId, v.value]));

      for (const item of cleaned) {
        const prev = oldMap.get(item.fieldId) ?? "";
        if (prev !== item.value) {
          createDealEvent(dealId, uid, "CUSTOM_FIELD_UPDATED", {
            fieldLabel: labelMap.get(item.fieldId) ?? item.fieldId,
            from: prev,
            to: item.value,
          }).catch(() => {});
        }
      }

      return NextResponse.json(updated);
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}
