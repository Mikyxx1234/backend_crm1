import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createCustomField, getCustomFields } from "@/services/custom-fields";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const url = new URL(request.url);
    const entity = url.searchParams.get("entity") || undefined;
    const fields = await getCustomFields(entity);
    return NextResponse.json(fields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao listar campos.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const type = typeof body.type === "string" ? body.type : "";
    if (!name || !label || !type) {
      return NextResponse.json({ message: "name, label e type são obrigatórios." }, { status: 400 });
    }
    const entity = typeof body.entity === "string" ? body.entity : "contact";
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
}
