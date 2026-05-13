/**
 * /api/profile
 * ────────────
 * Perfil do usuário autenticado. Usado pela sidebar (GET para hidratar o
 * popover de conta) e pela página `/settings/profile` (GET + PUT).
 *
 * Campos editáveis pelo dono da sessão:
 *  - name, email  (identidade)
 *  - avatarUrl    (upload via /api/profile/avatar grava e depois este PUT
 *                  só persiste a URL retornada; PUT com string vazia limpa
 *                  o avatar e volta ao fallback de iniciais)
 *  - phone        (opcional, formato livre)
 *  - signature    (assinatura anexada às mensagens — vazio = usa name)
 *  - closingMessage (sobrescreve a mensagem de encerramento da organização)
 *  - currentPassword + newPassword (rotação de senha protegida)
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatarUrl: true,
  phone: true,
  signature: true,
  closingMessage: true,
  createdAt: true,
} as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: PROFILE_SELECT,
  });
  return NextResponse.json(user);
}

type UpdatePayload = {
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  phone?: string | null;
  signature?: string | null;
  closingMessage?: string | null;
  currentPassword?: string;
  newPassword?: string;
};

/** Sanitiza string opcional: trim + conversão de "" em null para limpar campo. */
function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  let body: UpdatePayload;
  try {
    body = (await request.json()) as UpdatePayload;
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json(
        { message: "Nome não pode ficar vazio." },
        { status: 400 },
      );
    }
    data.name = name;
  }

  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { message: "E-mail não pode ficar vazio." },
        { status: 400 },
      );
    }
    data.email = email;
  }

  const avatar = nullableString(body.avatarUrl);
  if (avatar !== undefined) data.avatarUrl = avatar;

  const phone = nullableString(body.phone);
  if (phone !== undefined) data.phone = phone;

  const signature = nullableString(body.signature);
  if (signature !== undefined) data.signature = signature;

  const closing = nullableString(body.closingMessage);
  if (closing !== undefined) data.closingMessage = closing;

  if (body.newPassword && body.currentPassword) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });
    if (!user || !user.hashedPassword) {
      return NextResponse.json(
        { message: "Usuário não encontrado." },
        { status: 404 },
      );
    }
    const valid = await bcrypt.compare(body.currentPassword, user.hashedPassword);
    if (!valid) {
      return NextResponse.json(
        { message: "Senha atual incorreta." },
        { status: 400 },
      );
    }
    data.hashedPassword = await bcrypt.hash(body.newPassword, 10);
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: PROFILE_SELECT,
  });
  return NextResponse.json(updated);
}
