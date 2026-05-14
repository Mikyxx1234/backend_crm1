import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { deleteCustomField, getCustomFieldById, updateCustomField } from "@/services/custom-fields";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "settings:custom_fields",
      );
      if (denied) return denied;
      const { id } = await ctx.params;
      const field = await getCustomFieldById(id);
      if (!field) return NextResponse.json({ message: "Campo não encontrado." }, { status: 404 });
      return NextResponse.json(field);
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
        "settings:custom_fields",
      );
      if (denied) return denied;
      const { id } = await ctx.params;
      const body = (await request.json()) as Record<string, unknown>;
      const existing = await getCustomFieldById(id);
      let inboxLeadPanelOrder: number | null | undefined;
      if (body.inboxLeadPanelOrder !== undefined) {
        if (body.inboxLeadPanelOrder === null) {
          inboxLeadPanelOrder = null;
        } else {
          const n = Number(body.inboxLeadPanelOrder);
          inboxLeadPanelOrder = Number.isFinite(n) ? Math.floor(n) : null;
        }
      }

      const field = await updateCustomField(id, {
        label: typeof body.label === "string" ? body.label.trim() : undefined,
        type: typeof body.type === "string" ? (body.type as Parameters<typeof updateCustomField>[1]["type"]) : undefined,
        options: Array.isArray(body.options) ? body.options.filter((o): o is string => typeof o === "string") : undefined,
        required: typeof body.required === "boolean" ? body.required : undefined,
        ...((existing?.entity === "contact" || existing?.entity === "deal") && typeof body.showInInboxLeadPanel === "boolean"
          ? { showInInboxLeadPanel: body.showInInboxLeadPanel }
          : {}),
        ...((existing?.entity === "contact" || existing?.entity === "deal") && body.inboxLeadPanelOrder !== undefined
          ? { inboxLeadPanelOrder }
          : {}),
      });
      return NextResponse.json(field);
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "settings:custom_fields",
      );
      if (denied) return denied;
      const { id } = await ctx.params;
      await deleteCustomField(id);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}
