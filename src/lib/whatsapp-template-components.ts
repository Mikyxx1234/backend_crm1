/**
 * Extração padronizada dos componentes devolvidos pela Graph API da Meta para
 * um template (endpoint `message_templates`). Centralizado aqui para
 * reutilização em:
 *
 * - `/api/meta/whatsapp/call-permission-templates` (lista para o picker do chip)
 * - `/api/conversations/[id]/call-permission` (constrói o texto do log do chat)
 * - `settings/whatsapp-templates` (preview do body)
 */

export type TemplateComponents = {
  bodyText: string;
  headerText: string;
  footerText: string;
  buttons: string[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function extractTemplateComponents(components: unknown): TemplateComponents {
  const out: TemplateComponents = {
    bodyText: "",
    headerText: "",
    footerText: "",
    buttons: [],
  };
  if (!Array.isArray(components)) return out;

  for (const c of components) {
    const o = obj(c);
    const type = str(o.type).toUpperCase();
    const format = str(o.format).toUpperCase();

    if (type === "BODY") {
      out.bodyText = str(o.text);
      continue;
    }
    if (type === "HEADER") {
      if (!format || format === "TEXT") {
        out.headerText = str(o.text);
      }
      continue;
    }
    if (type === "FOOTER") {
      out.footerText = str(o.text);
      continue;
    }
    if (type === "BUTTONS" && Array.isArray(o.buttons)) {
      for (const b of o.buttons) {
        const btn = obj(b);
        const label = str(btn.text) || str(btn.title);
        if (label) out.buttons.push(label);
      }
    }
  }

  return out;
}
