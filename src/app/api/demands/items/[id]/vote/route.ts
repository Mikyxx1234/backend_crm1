import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { denyUnless, jsonError } from "../../../_guard";
import { toggleVote } from "@/services/demands";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "demand:vote");
    if (denied) return denied;
    const { id } = await ctx.params;
    const result = await toggleVote(session.user.id, id);
    if (!result) return jsonError("Demanda não encontrada.", 404);
    return NextResponse.json(result);
  });
}
