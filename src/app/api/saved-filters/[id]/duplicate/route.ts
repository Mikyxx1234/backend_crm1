import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { duplicateSavedFilter } from "@/services/saved-filters";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
      const { id } = await ctx.params;
      const created = await duplicateSavedFilter(user, id);
      return NextResponse.json(created, { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao duplicar.";
      const status = /n[ãa]o encontrado/i.test(msg) ? 404 : 500;
      return NextResponse.json({ message: msg }, { status });
    }
  });
}
