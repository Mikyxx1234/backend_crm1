import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { addNote, listNotes } from "@/services/team-chat";
import { denyUnless, jsonError, viewerOf } from "../../../_guard";

const Create = z.object({ content: z.string().min(1).max(4000) });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "team_chat:view");
    if (denied) return denied;
    const { id } = await params;
    const result = await listNotes(viewerOf(session), id);
    if ("error" in result) return jsonError(result.error, result.status);
    return NextResponse.json(result);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "team_chat:send");
    if (denied) return denied;
    const { id } = await params;
    const parsed = Create.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonError("Nota inválida.", 400);
    const result = await addNote(viewerOf(session), id, parsed.data.content);
    if ("error" in result) return jsonError(result.error, result.status);
    return NextResponse.json(result.note, { status: 201 });
  });
}
