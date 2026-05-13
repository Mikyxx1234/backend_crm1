import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";
import { extractTemplateComponents } from "@/lib/whatsapp-template-components";

function requireTemplates(): NextResponse | null {
  if (!metaWhatsApp.templatesConfigured) {
    return NextResponse.json(
      {
        message:
          "Configure META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID e META_WHATSAPP_BUSINESS_ACCOUNT_ID (WABA).",
      },
      { status: 503 },
    );
  }
  return null;
}

type TemplateRow = {
  name?: string;
  status?: string;
  sub_category?: string;
  category?: string;
  language?: string;
  id?: string;
  components?: unknown[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Templates aprovados candidatos a pedido de permissão de ligação (subcategoria Meta ou nome). */
function isCallPermissionCandidate(t: TemplateRow): boolean {
  const status = str(t.status).toUpperCase();
  if (status !== "APPROVED") return false;
  const name = str(t.name).toLowerCase();
  const sub = str(t.sub_category).toUpperCase();
  if (sub.includes("CALL_PERMISSION")) return true;
  if (/call_permission|callpermission/i.test(name)) return true;
  return false;
}

/**
 * GET: lista nomes de templates APPROVED usáveis para opt-in de chamada (seleção no inbox).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const denied = requireTemplates();
    if (denied) return denied;

    const raw = (await metaWhatsApp.listMessageTemplates({ limit: 200 })) as {
      data?: TemplateRow[];
    };
    const rows = Array.isArray(raw.data) ? raw.data : [];
    const items = rows
      .filter((r) => isCallPermissionCandidate(r))
      .map((r) => {
        const parts = extractTemplateComponents(r.components);
        return {
          id: str(r.id) || null,
          name: str(r.name),
          language: str(r.language) || "pt_BR",
          sub_category: str(r.sub_category) || null,
          bodyText: parts.bodyText,
          headerText: parts.headerText,
          footerText: parts.footerText,
          buttons: parts.buttons,
        };
      })
      .filter((x) => x.name);

    items.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ items });
  } catch (e: unknown) {
    console.error("[call-permission-templates] GET", e);
    const msg = e instanceof Error ? e.message : "Erro ao listar templates.";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
