import { NextResponse } from "next/server";
import path from "path";

import { auth } from "@/lib/auth";
import { generateFileName, saveFile } from "@/lib/storage/local";

const MAX_FILE_SIZE = 16 * 1024 * 1024;
const ALLOWED_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/octet-stream",
];

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const orgId = (session.user as { organizationId?: string | null }).organizationId ?? null;
    if (!orgId) {
      // Super-admin sem org assumida ainda. Mídia de automação tem que
      // ficar em algum tenant — exigimos org definida.
      return NextResponse.json(
        { message: "Selecione uma organização antes de subir mídia." },
        { status: 400 },
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { message: "Erro ao processar upload." },
        { status: 400 },
      );
    }

    const raw = form.get("file");
    if (!raw || !(raw instanceof Blob)) {
      return NextResponse.json(
        { message: 'Envie o arquivo no campo "file".' },
        { status: 400 },
      );
    }

    const file = raw as Blob & { name?: string };
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { message: `Arquivo excede o limite de ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }

    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_PREFIXES.some((p) => mime.startsWith(p))) {
      return NextResponse.json(
        { message: `Tipo de arquivo não permitido: ${mime}` },
        { status: 415 },
      );
    }

    const origName = (file as { name?: string }).name ?? "file";
    const ext = (path.extname(origName) || mimeToExt(mime)).replace(/^\./, "");
    const safeName = generateFileName({ prefix: "auto", ext });

    const buffer = Buffer.from(await file.arrayBuffer());

    // PR 1.3: storage tenant-scoped (antes: `public/uploads/<file>` shared).
    const saved = await saveFile({
      orgId,
      bucket: "automation-media",
      fileName: safeName,
      buffer,
    });
    return NextResponse.json({ url: saved.url, fileName: origName, mimeType: mime });
  } catch (e) {
    console.error("[automation-media] upload error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro interno." },
      { status: 500 },
    );
  }
}

function mimeToExt(mime: string): string {
  if (mime.startsWith("image/jpeg")) return ".jpg";
  if (mime.startsWith("image/png")) return ".png";
  if (mime.startsWith("image/webp")) return ".webp";
  if (mime.startsWith("image/gif")) return ".gif";
  if (mime.startsWith("video/mp4")) return ".mp4";
  if (mime.startsWith("video/webm")) return ".webm";
  if (mime.startsWith("audio/ogg")) return ".ogg";
  if (mime.startsWith("audio/mpeg")) return ".mp3";
  if (mime.startsWith("audio/mp4")) return ".m4a";
  if (mime.startsWith("application/pdf")) return ".pdf";
  return ".bin";
}
