import { readFile, stat } from "fs/promises";
import { NextResponse } from "next/server";
import pathModule from "path";

import { auth } from "@/lib/auth";

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

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { path: segments } = await context.params;
  const fileName = segments.join("/");

  if (/[/\\]\.\./.test(fileName) || fileName.includes("..")) {
    return NextResponse.json({ message: "Proibido." }, { status: 403 });
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

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
      },
    });
  } catch {
    return NextResponse.json({ message: "Arquivo não encontrado." }, { status: 404 });
  }
}
