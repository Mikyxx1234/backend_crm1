import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import type { AppUserRole } from "@/lib/auth-types";
import {
  getVisibilitySettings,
  setVisibilityForRole,
  type VisibilityMode,
} from "@/lib/visibility";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Nao autorizado." }, { status: 401 });
    }

    const settings = await getVisibilitySettings();
    return NextResponse.json(settings);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao carregar configuracoes." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Nao autorizado." }, { status: 401 });
    }

    const role = (session.user as { role?: AppUserRole }).role;
    if (role !== "ADMIN") {
      return NextResponse.json(
        { message: "Apenas administradores podem alterar permissoes." },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON invalido." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Corpo invalido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const validModes = new Set<string>(["all", "own"]);

    const updates: { role: "MANAGER" | "MEMBER"; mode: VisibilityMode }[] = [];

    if (b.MANAGER !== undefined) {
      if (typeof b.MANAGER !== "string" || !validModes.has(b.MANAGER)) {
        return NextResponse.json(
          { message: "Valor invalido para MANAGER." },
          { status: 400 }
        );
      }
      updates.push({ role: "MANAGER", mode: b.MANAGER as VisibilityMode });
    }

    if (b.MEMBER !== undefined) {
      if (typeof b.MEMBER !== "string" || !validModes.has(b.MEMBER)) {
        return NextResponse.json(
          { message: "Valor invalido para MEMBER." },
          { status: 400 }
        );
      }
      updates.push({ role: "MEMBER", mode: b.MEMBER as VisibilityMode });
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { message: "Nenhuma alteracao fornecida." },
        { status: 400 }
      );
    }

    for (const u of updates) {
      await setVisibilityForRole(u.role, u.mode);
    }

    const settings = await getVisibilitySettings();
    return NextResponse.json(settings);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao salvar configuracoes." },
      { status: 500 }
    );
  }
}
