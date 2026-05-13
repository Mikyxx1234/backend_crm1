import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";

function requireTemplates(): NextResponse | null {
  if (!metaWhatsApp.templatesConfigured) {
    return NextResponse.json(
      {
        message:
          "Configure META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID e META_WHATSAPP_BUSINESS_ACCOUNT_ID (WABA). O token precisa do escopo whatsapp_business_management.",
      },
      { status: 503 },
    );
  }
  return null;
}

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

/**
 * GET: lista templates da WABA (Graph `message_templates`).
 * POST: cria template — corpo assistido ou `{ "raw": true, "payload": { ... } }` (JSON oficial Meta).
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const denied = requireTemplates();
    if (denied) return denied;

    const url = new URL(request.url);
    const after = url.searchParams.get("after") ?? undefined;
    const lim = url.searchParams.get("limit");
    const limit = lim ? Number.parseInt(lim, 10) : undefined;

    const data = await metaWhatsApp.listMessageTemplates({
      after,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json(data);
  } catch (e: unknown) {
    console.error("[meta-templates] GET", e);
    const msg = e instanceof Error ? e.message : "Erro ao listar templates na Meta.";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const roleDenied = requireAdminOrManager(session);
    if (roleDenied) return roleDenied;
    const denied = requireTemplates();
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    if (b.raw === true && b.payload && typeof b.payload === "object" && !Array.isArray(b.payload)) {
      const data = await metaWhatsApp.createMessageTemplate(b.payload as Record<string, unknown>);
      return NextResponse.json(data, { status: 201 });
    }

    const nameRaw = typeof b.name === "string" ? b.name.trim().toLowerCase() : "";
    const name = nameRaw.replace(/-/g, "_");
    const language =
      typeof b.language === "string" && b.language.trim() ? b.language.trim() : "pt_BR";
    const category = (typeof b.category === "string" ? b.category.trim() : "").toUpperCase();
    const validCat = ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(category);

    if (!name || !/^[a-z0-9_]+$/.test(name)) {
      return NextResponse.json(
        { message: "Nome inválido: use apenas letras minúsculas, números e sublinhado (ex.: cobranca_vencida)." },
        { status: 400 },
      );
    }
    if (!validCat) {
      return NextResponse.json(
        { message: "Categoria inválida. Use UTILITY, MARKETING ou AUTHENTICATION." },
        { status: 400 },
      );
    }

    const bodyText = typeof b.body === "string" ? b.body.trim() : "";
    if (!bodyText) {
      return NextResponse.json({ message: "Texto do corpo (body) é obrigatório." }, { status: 400 });
    }

    const parameterFormat = b.parameterFormat === "NAMED" ? "NAMED" : "POSITIONAL";
    const components: Record<string, unknown>[] = [];

    const headerFormat = typeof b.headerFormat === "string" ? b.headerFormat : "NONE";
    if (headerFormat === "TEXT") {
      const ht = typeof b.headerText === "string" ? b.headerText.trim() : "";
      if (ht) {
        const hc: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: ht };
        if (parameterFormat === "NAMED" && b.headerExample && typeof b.headerExample === "object") {
          hc.example = b.headerExample;
        }
        components.push(hc);
      }
    }

    if (category === "AUTHENTICATION") {
      const compBody: Record<string, unknown> = {
        type: "BODY",
        text: bodyText,
        add_security_recommendation: Boolean(b.addSecurityRecommendation),
      };
      components.push(compBody);
      const minutes = typeof b.codeExpirationMinutes === "number" ? b.codeExpirationMinutes : 10;
      if (minutes > 0) {
        components.push({ type: "FOOTER", code_expiration_minutes: minutes });
      }
      const otpType =
        typeof b.otpType === "string" && b.otpType.trim() ? b.otpType.trim() : "COPY_CODE";
      const otpText =
        typeof b.otpButtonText === "string" && b.otpButtonText.trim()
          ? b.otpButtonText.trim().slice(0, 25)
          : "Copiar código";
      components.push({
        type: "BUTTONS",
        buttons: [{ type: "OTP", otp_type: otpType, text: otpText }],
      });
    } else {
      const compBody: Record<string, unknown> = { type: "BODY", text: bodyText };
      if (parameterFormat === "NAMED" && b.bodyExample && typeof b.bodyExample === "object") {
        compBody.example = b.bodyExample;
      }
      components.push(compBody);

      const footer = typeof b.footer === "string" ? b.footer.trim() : "";
      if (footer) {
        components.push({ type: "FOOTER", text: footer });
      }

      if (Array.isArray(b.buttons) && b.buttons.length > 0) {
        components.push({ type: "BUTTONS", buttons: b.buttons });
      }
    }

    const payload: Record<string, unknown> = {
      name,
      language,
      category,
      components,
    };

    if (category === "MARKETING" || category === "UTILITY") {
      payload.parameter_format = parameterFormat;
    }

    const data = await metaWhatsApp.createMessageTemplate(payload);
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    console.error("[meta-templates] POST", e);
    const msg = e instanceof Error ? e.message : "Erro ao criar template na Meta.";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
