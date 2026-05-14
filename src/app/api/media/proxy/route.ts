import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const META_DOMAINS = ["lookaside.fbsbx.com", "scontent.whatsapp.net", "graph.facebook.com"];

function isMetaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return META_DOMAINS.some((d) => host.endsWith(d));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mediaUrl = searchParams.get("url");
  if (!mediaUrl || !isMetaUrl(mediaUrl)) {
    return NextResponse.json({ message: "URL inválida." }, { status: 400 });
  }

  const token = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ message: "Token Meta não configurado." }, { status: 503 });
  }

  try {
    const res = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { message: `Meta retornou ${res.status}. A mídia pode ter expirado.` },
        { status: 502 }
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "application/octet-stream";

    // PR 1.3: removido cache lateral em public/uploads (vazava mídia
    // entre orgs e não era reutilizado). Streaming direto para o cliente.
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("[media-proxy] Error:", err);
    return NextResponse.json({ message: "Erro ao buscar mídia." }, { status: 502 });
  }
}
