/**
 * Legacy file gateway (`/uploads/...` ou `/api/uploads/...`).
 *
 * **Status:** mantido até o backfill PR 1.3 mover todos os arquivos
 * de `public/uploads/` para `<STORAGE_ROOT>/<orgId>/<bucket>/`. Depois
 * pode ser removido em conjunto com o volume legacy.
 *
 * Antes de PR 1.3 este endpoint só fazia `auth()` — qualquer usuário
 * logado de qualquer org acessava qualquer arquivo. Agora resolve o
 * tenant do arquivo via lookup no DB (Message.mediaUrl, User.avatarUrl,
 * Contact.avatarUrl) e bloqueia se a sessão atual não pertencer ao
 * tenant correto.
 *
 * Custo extra: 1-3 queries indexed por request (negligível). Aceitável
 * porque é caminho deprecated.
 *
 * @see docs/storage-tenancy.md
 */
import { readFile, stat } from "fs/promises";
import { NextResponse } from "next/server";
import pathModule from "path";

import { auth } from "@/lib/auth";
import { prismaBase } from "@/lib/prisma-base";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo", "3gp": "video/3gpp",
  webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4",
  wav: "audio/wav", aac: "audio/aac", amr: "audio/amr", opus: "audio/opus",
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain",
};

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Resolve o `organizationId` "dono" de um arquivo legacy a partir do
 * filename relativo (e.g. `1730000000-abc123.jpg` ou
 * `avatars/u_xyz.jpg` ou `call-recordings/call-123.webm`).
 *
 * Retorna null se nenhuma referência foi encontrada — caller deve
 * tratar como 404 (arquivo órfão sem dono = não-servir, defensivo).
 */
async function resolveLegacyOrgId(filenameRelative: string): Promise<string | null> {
  const candidates = [
    `/uploads/${filenameRelative}`,
    `/uploads/${filenameRelative}?`, // tolera querystrings
  ];

  // 1) Mensagem com mediaUrl correspondente (pega organizationId via conversation).
  for (const url of candidates) {
    const msg = await prismaBase.message.findFirst({
      where: {
        OR: [{ mediaUrl: url }, { mediaUrl: { startsWith: url } }],
      },
      select: { conversation: { select: { organizationId: true } } },
    });
    if (msg?.conversation?.organizationId) {
      return msg.conversation.organizationId;
    }
  }

  // 2) Avatar de usuário (User.avatarUrl). Lookup tolera ?v=... no fim.
  const userMatch = await prismaBase.user.findFirst({
    where: { avatarUrl: { startsWith: candidates[0] } },
    select: { organizationId: true },
  });
  if (userMatch?.organizationId) return userMatch.organizationId;

  // 3) Avatar de contato (Contact.avatarUrl).
  const contactMatch = await prismaBase.contact.findFirst({
    where: { avatarUrl: { startsWith: candidates[0] } },
    select: { organizationId: true },
  });
  if (contactMatch?.organizationId) return contactMatch.organizationId;

  return null;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { path: segments } = await context.params;
  const fileName = (segments ?? []).join("/");

  if (/[/\\]\.\./.test(fileName) || fileName.includes("..")) {
    return NextResponse.json({ message: "Proibido." }, { status: 403 });
  }

  // Multi-tenancy enforcement: descobre o tenant dono do arquivo.
  const sUser = session.user as {
    organizationId?: string | null;
    isSuperAdmin?: boolean;
  };
  const sessionOrgId = sUser.organizationId ?? null;
  const isSuperAdmin = Boolean(sUser.isSuperAdmin);

  if (!isSuperAdmin) {
    const ownerOrgId = await resolveLegacyOrgId(fileName);
    if (!ownerOrgId) {
      // Arquivo sem referência no DB ⇒ órfão. Não servimos.
      return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    }
    if (ownerOrgId !== sessionOrgId) {
      // 404 (não 403) pra não confirmar existência cross-tenant.
      return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
    }
  }

  const filePath = pathModule.join(process.cwd(), "public", "uploads", fileName);

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ message: "Não encontrado." }, { status: 404 });
    }

    const buffer = await readFile(filePath);
    const ext = pathModule.extname(fileName).slice(1).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
        "Deprecation": "true",
        "Link": "</api/storage>; rel=\"successor-version\"",
      },
    });
  } catch {
    return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
  }
}
