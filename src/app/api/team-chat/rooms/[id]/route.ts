import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getRoom } from "@/services/team-chat";
import { denyUnless, jsonError, viewerOf } from "../../_guard";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "team_chat:view");
    if (denied) return denied;
    const { id } = await params;
    const result = await getRoom(viewerOf(session), id);
    if ("error" in result) return jsonError(result.error, result.status);
    return NextResponse.json(result.room);
  });
}
