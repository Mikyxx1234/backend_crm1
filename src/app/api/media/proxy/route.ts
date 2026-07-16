import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isAllowedMetaMediaUrl } from "@/lib/meta-media-url";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mediaUrl = searchParams.get("url");
  if (!mediaUrl || !isAllowedMetaMediaUrl(mediaUrl)) {
    return NextResponse.json({ message: "URL inválida." }, { status: 400 });
  }

  const token = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ message: "Token Meta não configurado." }, { status: 503 });
  }

  try {
    // Repassa o Range do cliente ao upstream. O <video> do Chrome exige
    // resposta 206 (Partial Content) para tocar/buscar — sem isso o player
    // fica preto em 0:00. Meta/WhatsApp CDN suporta range requests.
    const upstreamHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    const range = request.headers.get("range");
    if (range) upstreamHeaders["Range"] = range;

    const res = await fetch(mediaUrl, {
      headers: upstreamHeaders,
      cache: "no-store",
    });

    // 200 (completo) e 206 (parcial) são ambos válidos.
    if (!res.ok && res.status !== 206) {
      return NextResponse.json(
        { message: `Meta retornou ${res.status}. A mídia pode ter expirado.` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const outHeaders = new Headers({
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    // Preserva headers de range/tamanho do upstream para o player.
    const contentRange = res.headers.get("content-range");
    if (contentRange) outHeaders.set("Content-Range", contentRange);
    const contentLength = res.headers.get("content-length");
    if (contentLength) outHeaders.set("Content-Length", contentLength);

    // PR 1.3: removido cache lateral em public/uploads (vazava mídia
    // entre orgs). Streaming direto do body para o cliente — evita
    // carregar o vídeo inteiro em memória.
    return new Response(res.body, {
      status: res.status,
      headers: outHeaders,
    });
  } catch (err) {
    console.error("[media-proxy] Error:", err);
    return NextResponse.json({ message: "Erro ao buscar mídia." }, { status: 502 });
  }
}
