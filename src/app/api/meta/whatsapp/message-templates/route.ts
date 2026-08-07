import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

/**
 * Timeout pra baixar a mídia de exemplo (HEADER IMAGE/VIDEO/DOCUMENT) de uma
 * URL HTTPS externa antes de subir via Resumable Upload API. Mesmo racional
 * do `GRAPH_TIMEOUT_MS` do client: falhar cedo com erro claro em vez de
 * pendurar a requisição até o proxy reverso devolver 502.
 */
const HEADER_MEDIA_FETCH_TIMEOUT_MS = 20_000;

/**
 * Resolve os bytes da mídia de exemplo do HEADER (IMAGE/VIDEO/DOCUMENT) a
 * partir de `headerMediaUrl` — aceita upload interno (`/api/storage/...`
 * tenant-scoped ou `/uploads/...` legacy) ou URL HTTPS pública. Mesmo
 * padrão usado pelo executor de automações ao resolver mídia de envio
 * (ver `resolveTemplateHeaderMediaParam` em `automation-executor.ts`).
 */
async function resolveHeaderMediaBuffer(
  mediaUrl: string,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const trimmed = mediaUrl.trim();
  const { parseStoragePath, readStoredFile, mimeFromFilename } = await import(
    "@/lib/storage/local"
  );
  const parsedStorage = parseStoragePath(trimmed);
  const isLegacyLocal = !parsedStorage && trimmed.startsWith("/uploads/");

  if (parsedStorage) {
    const stored = await readStoredFile(
      parsedStorage.orgId,
      parsedStorage.bucket,
      parsedStorage.fileName,
    );
    if (!stored) {
      throw new Error(`Arquivo da mídia de exemplo não encontrado em storage (${trimmed}).`);
    }
    return { buffer: stored.buffer, mimeType: stored.mimeType, fileName: parsedStorage.fileName };
  }

  if (isLegacyLocal) {
    const { readFile } = await import("fs/promises");
    const { join, basename } = await import("path");
    const filePath = join(process.cwd(), "public", trimmed);
    const buffer = await readFile(filePath);
    const fileName = basename(trimmed);
    return { buffer, mimeType: mimeFromFilename(fileName), fileName };
  }

  if (trimmed.startsWith("https://")) {
    let res: Response;
    try {
      res = await fetch(trimmed, {
        cache: "no-store",
        signal: AbortSignal.timeout(HEADER_MEDIA_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(
          `Tempo limite ao baixar a mídia de exemplo do cabeçalho (${HEADER_MEDIA_FETCH_TIMEOUT_MS}ms): ${trimmed}`,
        );
      }
      throw new Error(
        `Falha ao baixar a mídia de exemplo do cabeçalho (${trimmed}): ${err instanceof Error ? err.message : err}`,
      );
    }
    if (!res.ok) {
      throw new Error(`Falha ao baixar a mídia de exemplo do cabeçalho (HTTP ${res.status}): ${trimmed}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    const fileName = trimmed.split("?")[0].split("/").pop() || "header-media";
    const mimeType = contentType || mimeFromFilename(fileName);
    return { buffer, mimeType, fileName };
  }

  throw new Error(
    `URL da mídia de exemplo inválida — use uma URL HTTPS pública ou um caminho de upload interno (/api/storage/... ou /uploads/...): ${trimmed}`,
  );
}

/**
 * GET: lista templates da WABA (Graph `message_templates`).
 * POST: cria template — corpo assistido ou `{ "raw": true, "payload": { ... } }` (JSON oficial Meta).
 *
 * Credenciais Meta vêm do canal Cloud API da organização (não do env global),
 * para evitar vazamento multi-tenant entre tenants.
 */
export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const url = new URL(request.url);
      const channelId = url.searchParams.get("channelId");
      const resolved = await resolveMetaTemplatesClient({
        organizationId: session.user.organizationId,
        isSuperAdmin: session.user.isSuperAdmin,
        channelId,
      });
      if (!resolved.ok) return resolved.response;

      const after = url.searchParams.get("after") ?? undefined;
      const lim = url.searchParams.get("limit");
      const limit = lim ? Number.parseInt(lim, 10) : undefined;

      const data = await resolved.client.listMessageTemplates({
        after,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return NextResponse.json(data);
    } catch (e: unknown) {
      console.error("[meta-templates] GET", e);
      const msg = e instanceof Error ? e.message : "Erro ao listar templates na Meta.";
      return NextResponse.json({ message: msg }, { status: 502 });
    }
  });
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const roleDenied = requireAdminOrManager(session);
      if (roleDenied) return roleDenied;

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
      }
      const b = body as Record<string, unknown>;
      const url = new URL(request.url);
      const channelIdFromQuery = url.searchParams.get("channelId");
      const channelIdFromBody =
        typeof b.channelId === "string" && b.channelId.trim() ? b.channelId.trim() : null;

      const resolved = await resolveMetaTemplatesClient({
        organizationId: session.user.organizationId,
        isSuperAdmin: session.user.isSuperAdmin,
        channelId: channelIdFromBody ?? channelIdFromQuery,
      });
      if (!resolved.ok) return resolved.response;

      const metaClient = resolved.client;

      if (b.raw === true && b.payload && typeof b.payload === "object" && !Array.isArray(b.payload)) {
        const data = await metaClient.createMessageTemplate(b.payload as Record<string, unknown>);
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
      } else if (headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT") {
        const headerMediaUrl = typeof b.headerMediaUrl === "string" ? b.headerMediaUrl.trim() : "";
        if (!headerMediaUrl) {
          return NextResponse.json(
            {
              message: `Cabeçalho ${headerFormat}: informe a URL (ou faça upload) da mídia de exemplo — a Meta exige isso ao criar o template.`,
            },
            { status: 400 },
          );
        }
        try {
          const { buffer, mimeType, fileName } = await resolveHeaderMediaBuffer(headerMediaUrl);
          const headerHandle = await metaClient.uploadResumableHandle(buffer, mimeType, fileName);
          components.push({
            type: "HEADER",
            format: headerFormat,
            example: { header_handle: [headerHandle] },
          });
        } catch (mediaErr: unknown) {
          console.error("[meta-templates] header media", mediaErr);
          const msg =
            mediaErr instanceof Error ? mediaErr.message : "Erro ao preparar a mídia de exemplo do cabeçalho.";
          return NextResponse.json({ message: msg }, { status: 400 });
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

      const data = await metaClient.createMessageTemplate(payload);
      return NextResponse.json(data, { status: 201 });
    } catch (e: unknown) {
      console.error("[meta-templates] POST", e);
      const msg = e instanceof Error ? e.message : "Erro ao criar template na Meta.";
      return NextResponse.json({ message: msg }, { status: 502 });
    }
  });
}
