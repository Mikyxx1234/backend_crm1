import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { convertToMp3, guessInputExt } from "@/lib/audio-convert";

/**
 * Domínios Meta autorizados para fetch direto. Qualquer outro host
 * exige que a URL seja relativa ao próprio app (servida por
 * `/uploads` ou pela rota `/api/media/proxy`).
 */
const META_DOMAINS = ["lookaside.fbsbx.com", "scontent.whatsapp.net", "graph.facebook.com"];

function isMetaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return META_DOMAINS.some((d) => host.endsWith(d));
  } catch {
    return false;
  }
}

/**
 * Resolve uma URL (absoluta ou relativa) num Buffer de áudio bruto.
 * Aceita 3 cenários:
 *
 *   1) Caminho relativo `/uploads/foo.ogg` → lê do disco direto
 *      (rota canônica para áudios baixados pelo bot/upload).
 *   2) URL absoluta de domínio Meta → fetch com bearer token Meta.
 *   3) URL absoluta do mesmo origin (`/api/...`) → fetch HTTP normal
 *      (cookies do session repassados via header).
 *
 * Retorna `{ buffer, contentType, urlPath }` ou lança Error.
 */
async function fetchAudioBuffer(
  rawUrl: string,
  request: Request,
): Promise<{ buffer: Buffer; contentType: string; urlPath: string }> {
  const decoded = decodeURIComponent(rawUrl);

  if (isMetaUrl(decoded)) {
    const token = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
    if (!token) throw new Error("Token Meta não configurado.");
    const res = await fetch(decoded, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Meta retornou ${res.status}.`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") || "audio/ogg",
      urlPath: decoded,
    };
  }

  // PR 1.3: paths internos (`/uploads/...`, `/api/storage/...`,
  // `/api/media/proxy?...`) sempre passam por HTTP fetch com cookies
  // de sessão repassados — assim o middleware/gateway aplica auth +
  // checagem de tenant. Ler do FS direto bypassaria essa validação.
  if (decoded.startsWith("/")) {
    const origin = new URL(request.url).origin;
    const cookie = request.headers.get("cookie") ?? "";
    const res = await fetch(`${origin}${decoded}`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Origem retornou ${res.status}.`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") || "audio/ogg",
      urlPath: decoded,
    };
  }

  throw new Error("URL não autorizada.");
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");
  const desiredName = (searchParams.get("name") || "audio").replace(/[^\w\-]+/g, "-");

  if (!rawUrl) {
    return NextResponse.json({ message: "URL ausente." }, { status: 400 });
  }

  try {
    const { buffer, contentType } = await fetchAudioBuffer(rawUrl, request);

    // Se o arquivo já é MP3, devolve direto sem reconverter.
    const baseMime = contentType.split(";")[0].trim();
    if (baseMime === "audio/mpeg") {
      const fileName = `${desiredName}.mp3`;
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(buffer.length),
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    const inputExt = guessInputExt(baseMime);
    const mp3 = await convertToMp3(buffer, inputExt === "bin" ? "webm" : inputExt);

    if (!mp3) {
      // Fallback: devolve o original com o nome `.mp3` solicitado.
      // Não é "verdadeiramente" MP3, mas ainda é melhor que falhar
      // — players modernos abrem ogg/webm sem problema mesmo com
      // extensão errada (e o operador é avisado via header custom).
      const fileName = `${desiredName}.${inputExt === "bin" ? "ogg" : inputExt}`;
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": baseMime,
          "Content-Length": String(buffer.length),
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "X-Audio-Conversion": "failed-fallback-original",
          "Cache-Control": "private, no-store",
        },
      });
    }

    const fileName = `${desiredName}.mp3`;
    return new Response(new Uint8Array(mp3), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3.length),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Audio-Conversion": "ok",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[audio-mp3] Error:", err);
    const message = err instanceof Error ? err.message : "Erro desconhecido.";
    return NextResponse.json({ message }, { status: 502 });
  }
}
