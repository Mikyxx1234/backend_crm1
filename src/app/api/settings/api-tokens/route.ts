import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { generateToken, listTokens } from "@/services/api-tokens";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const tokens = await listTokens(session.user.id);
    return NextResponse.json(tokens);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao listar tokens." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) {
      return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
    }

    let expiresAt: Date | null = null;
    if (typeof b.expiresAt === "string" && b.expiresAt.trim()) {
      const d = new Date(b.expiresAt);
      if (!Number.isNaN(d.getTime()) && d > new Date()) {
        expiresAt = d;
      }
    }

    const result = await generateToken(session.user.id, name, expiresAt);

    return NextResponse.json(
      {
        id: result.id,
        token: result.token,
        prefix: result.prefix,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao criar token." }, { status: 500 });
  }
}
