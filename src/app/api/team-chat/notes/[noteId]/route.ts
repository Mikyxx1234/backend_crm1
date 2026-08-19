import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { deleteNote, toggleNotePin } from "@/services/team-chat";
import { denyUnless, jsonError, viewerOf } from "../../_guard";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "team_chat:send");
    if (denied) return denied;
    const { noteId } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "pin") return jsonError("Ação inválida.", 400);
    const result = await toggleNotePin(viewerOf(session), noteId);
    if ("error" in result) return jsonError(result.error, result.status);
    return NextResponse.json(result.note);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "team_chat:send");
    if (denied) return denied;
    const { noteId } = await params;
    const result = await deleteNote(viewerOf(session), noteId);
    if ("error" in result) return jsonError(result.error, result.status);
    return NextResponse.json(result);
  });
}
