/**
 * GET /api/storage/<organizationId>/<bucket>/<fileName>
 *
 * Gateway autenticado para arquivos persistidos pelo módulo
 * `src/lib/storage/local.ts`. Garante isolamento multi-tenant: a
 * sessão atual precisa ter `organizationId === <organizationId>`
 * (ou ser super-admin) — caso contrário responde 404 (sem revelar
 * existência do arquivo).
 *
 * O endpoint legacy `/api/uploads/[...path]` continua funcionando até
 * o backfill mover todos os arquivos pra layout novo (PR 1.3 backfill).
 *
 * @see docs/storage-tenancy.md
 */
import { open, stat } from "fs/promises";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  mimeFromFilename,
  parseStoragePath,
  readStoredFile,
  resolveStoragePath,
} from "@/lib/storage/local";

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Fallback opcional: quando o arquivo não existe no disco local, tenta
 * buscá-lo num backend upstream (ex.: o backend deployado em produção).
 *
 * Configurar via env:
 *   STORAGE_FALLBACK_URL=https://banco-backend-crm.6tqx2r.easypanel.host
 *
 * Útil em dev quando o webhook do Meta entrega a mídia no container
 * deployado (que tem o storage no /app/storage), mas o frontend está
 * apontado para o backend local. Ambos compartilham NEXTAUTH_SECRET, então
 * o token de sessão é interoperável — só precisamos traduzir o nome do
 * cookie (sem `__Secure-` em http → com `__Secure-` em https).
 */
function getFallbackBase(): string | null {
  const raw = process.env.STORAGE_FALLBACK_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/**
 * Lê o JWT de sessão do header `cookie` do request original. Esse é o
 * mesmo valor que `auth()` valida — independe do nome `__Secure-` por
 * causa do mesmo NEXTAUTH_SECRET.
 */
function extractSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  // Pode vir com qualquer um dos dois nomes (http vs https).
  const NAMES = [
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
  ];
  for (const name of NAMES) {
    const re = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}=([^;]+)`);
    const m = cookieHeader.match(re);
    if (m && m[1]) return decodeURIComponent(m[1]);
  }
  return null;
}

async function tryUpstreamFallback(
  request: Request,
  joined: string,
): Promise<Response | null> {
  const base = getFallbackBase();
  if (!base) {
    console.warn("[storage] upstream fallback desativado: STORAGE_FALLBACK_URL ausente");
    return null;
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieNames = cookieHeader
    ? cookieHeader.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean)
    : [];
  const sessionToken = extractSessionToken(cookieHeader);

  console.log(
    `[storage] upstream fallback: cookies recebidos=[${cookieNames.join(",")}] sessionToken=${sessionToken ? sessionToken.slice(0, 20) + "..." : "AUSENTE"}`,
  );

  if (!sessionToken) return null;

  // Forwarda o cookie ORIGINAL inteiro + duplica o JWT sob os 4 nomes que
  // NextAuth v4/v5 conhece (com e sem __Secure-). Isso cobre qualquer
  // versão do upstream sem precisar saber o nome exato.
  const variants = [
    `__Secure-authjs.session-token=${encodeURIComponent(sessionToken)}`,
    `authjs.session-token=${encodeURIComponent(sessionToken)}`,
    `__Secure-next-auth.session-token=${encodeURIComponent(sessionToken)}`,
    `next-auth.session-token=${encodeURIComponent(sessionToken)}`,
  ];
  const upstreamCookie = [cookieHeader, ...variants].filter(Boolean).join("; ");

  const upstreamUrl = `${base}/api/storage/${joined}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        cookie: upstreamCookie,
        // Algumas verificações de NextAuth checam Host/Origin/Referer.
        host: new URL(base).host,
      },
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => "(no body)");
      console.warn(
        `[storage] upstream fallback ${upstream.status} para ${joined}: ${errBody.slice(0, 200)}`,
      );
      return null;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    console.log(`[storage] upstream fallback OK (${buf.length}b) para ${joined}`);
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=300",
        "X-Storage-Source": "upstream-fallback",
      },
    });
  } catch (err) {
    console.warn("[storage] upstream fallback erro:", err);
    return null;
  }
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { path: segments } = await context.params;
  const joined = (segments ?? []).join("/");
  const parsed = parseStoragePath(joined);
  if (!parsed) {
    return NextResponse.json({ message: "Caminho inválido." }, { status: 400 });
  }

  // Multi-tenancy enforcement: só super-admin atravessa orgs.
  const sUser = session.user as {
    organizationId?: string | null;
    isSuperAdmin?: boolean;
  };
  const sessionOrgId = sUser.organizationId ?? null;
  const isSuperAdmin = Boolean(sUser.isSuperAdmin);

  if (!isSuperAdmin && sessionOrgId !== parsed.orgId) {
    // 404 (e não 403) pra não confirmar existência.
    return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
  }

  // 16/jul/26 — Suporte a HTTP Range. Sem isso, `<video controls>` do
  // HTML5 nao inicia a reproducao (Safari/iOS falham sempre; Chrome
  // tolera arquivos pequenos e trava em vídeos maiores). Estrategia:
  //  1. `stat()` pra descobrir tamanho antes de ler o disco.
  //  2. Se o request trouxer `Range: bytes=start-end`, responde 206
  //     com apenas o slice via `fs.open().read()` — evita carregar
  //     video de 50MB inteiro na RAM.
  //  3. Sem Range, mantem o comportamento antigo (200 + full body),
  //     preservando imagem/audio/doc.
  // A validacao de auth ja foi feita acima; aqui e' so I/O + headers.
  let fileStat;
  try {
    const abs = resolveStoragePath(parsed.orgId, parsed.bucket, parsed.fileName);
    fileStat = await stat(abs);
  } catch {
    fileStat = null;
  }

  if (fileStat?.isFile()) {
    const total = fileStat.size;
    const mimeType = mimeFromFilename(parsed.fileName);
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      // Formato aceito: `bytes=<start>-<end?>`. Multi-range (RFC 7233)
      // nao e' usado por <video>/<audio> — nao suportamos pra simplificar.
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
          return new Response(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${total}`,
              "Accept-Ranges": "bytes",
            },
          });
        }

        const chunkSize = end - start + 1;
        const buffer = Buffer.alloc(chunkSize);
        const abs = resolveStoragePath(parsed.orgId, parsed.bucket, parsed.fileName);
        const fh = await open(abs, "r");
        try {
          await fh.read(buffer, 0, chunkSize, start);
        } finally {
          await fh.close();
        }

        return new Response(new Uint8Array(buffer), {
          status: 206,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=300",
            "X-Storage-Tenant": parsed.orgId,
          },
        });
      }
      // Range malformado: cai no fluxo full-body abaixo (comportamento
      // permissivo — alguns clients mandam ranges esquisitos).
    }
  }

  const file = await readStoredFile(parsed.orgId, parsed.bucket, parsed.fileName);
  if (file) {
    return new Response(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Cache-Control": "private, max-age=300",
        "Accept-Ranges": "bytes",
        // Hint pra service worker do PWA cachear privadamente.
        "X-Storage-Tenant": parsed.orgId,
      },
    });
  }

  // Arquivo não está no disco local — tenta upstream (deployed backend).
  const fallback = await tryUpstreamFallback(request, joined);
  if (fallback) return fallback;

  return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
}
