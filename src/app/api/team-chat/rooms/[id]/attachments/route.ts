import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { generateFileName, saveFile } from "@/lib/storage/local";
import { denyUnless, jsonError, viewerOf } from "../../../_guard";
import { isOwnedStorageUrl, type TeamChatAttachmentKind } from "@/services/team-chat";
import { prisma } from "@/lib/prisma";

const MAX_FILE_SIZE = 16 * 1024 * 1024;
const ALLOWED_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "text/plain",
  "text/csv",
];

function isFileLike(v: unknown): v is Blob & { name?: string } {
  return (
    v instanceof Blob ||
    (typeof v === "object" &&
      v !== null &&
      typeof (v as Blob).arrayBuffer === "function" &&
      typeof (v as Blob).size === "number")
  );
}

function kindFromMime(mime: string, asSticker: boolean): TeamChatAttachmentKind {
  if (asSticker && mime.startsWith("image/")) return "sticker";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function resolveMime(rawType: string, fileName: string): string {
  const blobMime = rawType?.split(";")[0].trim();
  if (blobMime && blobMime !== "application/octet-stream") return blobMime;
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "audio/webm",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
  };
  return map[ext] || blobMime || "application/octet-stream";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "team_chat:send");
    if (denied) return denied;
    const viewer = viewerOf(session);
    const { id: roomId } = await params;

    const member = await prisma.teamChatMember.findFirst({
      where: { roomId, userId: viewer.userId },
      select: { id: true },
    });
    if (!member) return jsonError("Conversa não encontrada.", 404);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError("Erro ao processar upload.", 400);
    }

    const raw = form.get("file");
    if (!isFileLike(raw)) return jsonError("Arquivo obrigatório.", 400);
    if (raw.size > MAX_FILE_SIZE) return jsonError("Arquivo muito grande (máx 16 MB).", 400);

    const fileName = (raw as File).name || "arquivo";
    const mime = resolveMime(raw.type, fileName);
    if (!ALLOWED_PREFIXES.some((p) => mime.startsWith(p))) {
      return jsonError(`Tipo não suportado: ${mime}`, 400);
    }

    const asSticker = form.get("sticker") === "1" || form.get("sticker") === "true";
    const ext = fileName.includes(".") ? fileName.split(".").pop()! : mime.split("/")[1] ?? "bin";
    const safeFileName = generateFileName({ prefix: "orbita", ext });
    const buffer = Buffer.from(await raw.arrayBuffer());
    const saved = await saveFile({
      orgId: viewer.organizationId,
      bucket: "attachments",
      fileName: safeFileName,
      buffer,
    });

    if (!isOwnedStorageUrl(saved.url, viewer.organizationId)) {
      return jsonError("Falha ao gravar anexo.", 500);
    }

    return NextResponse.json({
      attachment: {
        url: saved.url,
        name: fileName,
        mimeType: mime,
        size: raw.size,
        kind: kindFromMime(mime, asSticker),
      },
    });
  });
}
