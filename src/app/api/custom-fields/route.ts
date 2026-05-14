import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { createCustomField, getCustomFields } from "@/services/custom-fields";

function slugifyFieldName(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

async function buildUniqueFieldName(base: string, entity: string): Promise<string> {
  const root = base || "campo_personalizado";
  const existing = await prisma.customField.findMany({
    where: {
      entity,
      name: { startsWith: root },
    },
    select: { name: true },
  });
  const taken = new Set(existing.map((f) => f.name));
  if (!taken.has(root)) return root;
  let i = 2;
  while (taken.has(`${root}_${i}`)) i += 1;
  return `${root}_${i}`;
}

export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "settings:custom_fields",
      );
      if (denied) return denied;
      const url = new URL(request.url);
      const entity = url.searchParams.get("entity") || undefined;
      const fields = await getCustomFields(entity);
      return NextResponse.json(fields);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao listar campos.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "settings:custom_fields",
      );
      if (denied) return denied;
      const body = (await request.json()) as Record<string, unknown>;
      const requestedName = typeof body.name === "string" ? body.name.trim() : "";
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const type = typeof body.type === "string" ? body.type : "";
      if (!label || !type) {
        return NextResponse.json({ message: "label e type são obrigatórios." }, { status: 400 });
      }
      const entity = typeof body.entity === "string" ? body.entity : "contact";
      const baseName = slugifyFieldName(requestedName) || slugifyFieldName(label);
      const name = await buildUniqueFieldName(baseName, entity);
      const supportsPanel = entity === "contact" || entity === "deal";
      const showInInboxLeadPanel =
        supportsPanel && body.showInInboxLeadPanel === true;
      let inboxLeadPanelOrder: number | null | undefined;
      if (supportsPanel && body.inboxLeadPanelOrder !== undefined && body.inboxLeadPanelOrder !== null) {
        const n = Number(body.inboxLeadPanelOrder);
        inboxLeadPanelOrder = Number.isFinite(n) ? Math.floor(n) : null;
      } else if (supportsPanel && body.inboxLeadPanelOrder === null) {
        inboxLeadPanelOrder = null;
      }

      const field = await createCustomField({
        name,
        label,
        type: type as Parameters<typeof createCustomField>[0]["type"],
        options: Array.isArray(body.options) ? body.options.filter((o): o is string => typeof o === "string") : [],
        required: body.required === true,
        entity,
        showInInboxLeadPanel,
        inboxLeadPanelOrder: inboxLeadPanelOrder ?? null,
      });
      return NextResponse.json(field, { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao criar campo.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}
