import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  deleteSavedFilter,
  getSavedFilterById,
  updateSavedFilter,
} from "@/services/saved-filters";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
      const { id } = await ctx.params;
      const sf = await getSavedFilterById(user, id);
      if (!sf) return NextResponse.json({ message: "Não encontrado." }, { status: 404 });
      return NextResponse.json(sf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, ctx: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
      const { id } = await ctx.params;
      const body = (await request.json().catch(() => null)) as {
        name?: string;
        filterConfig?: Record<string, unknown>;
        isShared?: boolean;
        isDefault?: boolean;
      } | null;
      if (!body) {
        return NextResponse.json({ message: "Body inválido." }, { status: 400 });
      }
      const updated = await updateSavedFilter(user, id, body);
      return NextResponse.json(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao atualizar.";
      const status = /permiss[ãa]o|administrador|n[ãa]o encontrado/i.test(msg)
        ? msg.includes("encontrado")
          ? 404
          : 403
        : 500;
      return NextResponse.json({ message: msg }, { status });
    }
  });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
      const { id } = await ctx.params;
      await deleteSavedFilter(user, id);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao excluir.";
      const status = /permiss[ãa]o/i.test(msg) ? 403 : 500;
      return NextResponse.json({ message: msg }, { status });
    }
  });
}
