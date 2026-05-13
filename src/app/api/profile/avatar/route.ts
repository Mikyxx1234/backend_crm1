/**
 * POST /api/profile/avatar
 * ─────────────────────────
 * Upload da foto de perfil do usuário autenticado. Persiste em
 * `public/uploads/avatars/` (mesmo padrão das mídias de automação) e
 * retorna a URL pública relativa para ser gravada em `User.avatarUrl`
 * via PUT /api/profile (evita race: o cliente recebe a URL, atualiza o
 * próprio estado e só dispara o salvamento do form quando o operador
 * clica em "Salvar").
 *
 * Restrições de segurança:
 *  - Apenas image/* com tamanho ≤ 4 MB (avatar é pequeno; 4 MB já cobre
 *    fotos de celular em alta qualidade e mantém o disco enxuto).
 *  - Nome de arquivo aleatório prefixado pelo userId para facilitar
 *    auditoria e evitar colisões.
 */

import { mkdir, writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";

import { auth } from "@/lib/auth";

const MAX_AVATAR_SIZE = 4 * 1024 * 1024;

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".bin";
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
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
        { message: 'Envie a imagem no campo "file".' },
        { status: 400 },
      );
    }

    const file = raw as Blob & { name?: string };

    const mime = file.type || "application/octet-stream";
    if (!mime.startsWith("image/")) {
      return NextResponse.json(
        { message: "Envie uma imagem (JPG, PNG, WEBP ou GIF)." },
        { status: 415 },
      );
    }

    if (file.size > MAX_AVATAR_SIZE) {
      return NextResponse.json(
        {
          message: `Imagem excede o limite de ${MAX_AVATAR_SIZE / 1024 / 1024} MB.`,
        },
        { status: 413 },
      );
    }

    const ext = path.extname(file.name ?? "") || mimeToExt(mime);
    const safeName = `u_${session.user.id}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}${ext}`;

    const uploadsDir = path.join(process.cwd(), "public", "uploads", "avatars");
    await mkdir(uploadsDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadsDir, safeName), buffer);

    const url = `/uploads/avatars/${safeName}`;
    return NextResponse.json({ url, mimeType: mime });
  } catch (error) {
    console.error("[profile/avatar] upload failed", error);
    return NextResponse.json(
      { message: "Erro ao salvar a imagem." },
      { status: 500 },
    );
  }
}
