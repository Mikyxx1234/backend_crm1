import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { denyUnless, jsonError } from "../../../_guard";
import { addComment } from "@/services/demands";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  content: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "demand:comment");
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const parsed = Body.safeParse(body);
    if (!parsed.success) return jsonError("Dados inválidos.", 400);
    const comment = await addComment(session.user.id, id, parsed.data.content);
    if (!comment) return jsonError("Demanda não encontrada.", 404);
    return NextResponse.json(comment, { status: 201 });
  });
}
