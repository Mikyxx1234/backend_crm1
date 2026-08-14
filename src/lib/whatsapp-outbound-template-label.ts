/** Texto amigável gravado no histórico do chat (evita só `[Template: nome]`). */

export type OutboundTemplateKind = "call_permission" | "generic";

export type OutboundTemplateContentOptions = {
  /** Corpo real do template, já com placeholders resolvidos quando possível. */
  bodyText?: string | null;
  /** Rótulos dos botões na ordem em que aparecem no WhatsApp. */
  buttons?: string[] | null;
  /** Texto de cabeçalho (HEADER TEXT), se existir. */
  headerText?: string | null;
  /** Texto de rodapé (FOOTER), se existir. */
  footerText?: string | null;
};

export function buildOutboundTemplateMessageContent(
  templateName: string,
  kind: OutboundTemplateKind,
  category?: string | null,
  bodyPreview?: string | null,
  options?: OutboundTemplateContentOptions,
): string {
  const safe = templateName.trim();
  const catLabel = category?.toUpperCase() === "MARKETING" ? "Marketing"
    : category?.toUpperCase() === "UTILITY" ? "Utility"
    : category?.toUpperCase() === "AUTHENTICATION" ? "Autenticação"
    : category || null;

  const body = (options?.bodyText ?? bodyPreview ?? "").trim();
  const header = (options?.headerText ?? "").trim();
  const footer = (options?.footerText ?? "").trim();
  const buttons = (options?.buttons ?? []).map((b) => b.trim()).filter(Boolean);

  if (kind === "call_permission") {
    // Log do chat passa a refletir a *cópia real* enviada ao cliente (corpo +
    // botões), igual ao que ele vê no WhatsApp. Fallback para descrição
    // genérica só se a Meta não devolveu o conteúdo do template.
    const headerLine = header ? `*${header}*` : null;
    const bodyLines = body.length > 0 ? body : null;
    const buttonLines = buttons.length > 0
      ? buttons.map((b) => `▸ ${b}`).join("\n")
      : null;
    const footerLine = footer ? `_${footer}_` : null;

    if (bodyLines || buttonLines) {
      return [
        "📞 Pedido de permissão para ligações pelo WhatsApp",
        "",
        headerLine,
        bodyLines,
        buttonLines ? "" : null,
        buttonLines,
        footerLine ? "" : null,
        footerLine,
      ].filter((x): x is string => typeof x === "string" && x.length > 0).join("\n");
    }

    return [
      "📞 Pedido de permissão para ligações pelo WhatsApp",
      "",
      "O cliente recebe a mensagem-modelo com botões e pode aceitar ou recusar.",
      "",
      `Modelo: ${safe}`,
      catLabel ? `Categoria: ${catLabel}` : null,
    ].filter(Boolean).join("\n");
  }

  // Corpo aberto (header + texto + botões) — o que o cliente vê no WhatsApp.
  // Nome/categoria ficam no TemplateBadge da bolha; não repetir no texto.
  if (body || buttons.length > 0) {
    const headerLine = header ? `*${header}*` : null;
    const footerLine = footer ? `_${footer}_` : null;
    const buttonMarker = buttons.length > 0 ? `[Botões: ${buttons.join(", ")}]` : null;
    return [headerLine, body || null, footerLine, buttonMarker]
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .join("\n\n");
  }

  return [
    "📋 Modelo de mensagem enviado ao cliente pelo WhatsApp.",
    "",
    `Nome: ${safe}`,
    catLabel ? `Categoria: ${catLabel}` : null,
  ].filter(Boolean).join("\n");
}

/** Extrai o nome de mensagens gravadas como `[Template: x]`. */
export function extractLegacyBracketTemplateName(content: string): string | null {
  const m = content.trim().match(/^\[Template:\s*(.+?)\]\s*$/i);
  const name = m?.[1]?.trim() ?? "";
  return name || null;
}

/** Rótulos de botões do config da automação / campanha. */
export function buttonLabelsFromConfig(buttons: unknown): string[] {
  if (!Array.isArray(buttons)) return [];
  return buttons
    .map((b) => {
      if (typeof b === "string") return b.trim();
      if (!b || typeof b !== "object") return "";
      const o = b as Record<string, unknown>;
      for (const k of ["title", "text", "label"]) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    })
    .filter(Boolean);
}

export function parseTemplateMeta(content: string): { name: string; category: string | null } | null {
  const nameMatch = content.match(/(?:Nome|Modelo):\s*(.+)/i);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();
  const catMatch = content.match(/Categoria:\s*(.+)/i);
  const category = catMatch ? catMatch[1].trim() : null;
  return { name, category };
}

/** Mensagens antigas salvas como `[Template: x]`. */
export function prettifyLegacyBracketTemplateContent(content: string): string {
  const trimmed = content.trim();
  const m = trimmed.match(/^\[Template:\s*(.+?)\]\s*$/i);
  if (!m) return content;
  const name = m[1].trim();
  if (!name) return content;
  if (/call_permission/i.test(name)) {
    return buildOutboundTemplateMessageContent(name, "call_permission");
  }
  return buildOutboundTemplateMessageContent(name, "generic");
}

/** Mensagens antigas salvas só como `[interactive]` (antes do parser completo). */
export function prettifyLegacyInteractivePlaceholder(content: string): string {
  const t = content.trim();
  if (t === "[interactive]") {
    return "Resposta interativa (detalhe não guardado — mensagem antiga).";
  }
  return content;
}

export function prettifyChatMessageBody(content: string): string {
  return prettifyLegacyInteractivePlaceholder(prettifyLegacyBracketTemplateContent(content));
}
