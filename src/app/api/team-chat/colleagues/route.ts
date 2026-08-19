import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { listColleagues } from "@/services/team-chat";
import { denyUnless, viewerOf } from "../_guard";

export async function GET() {
  return withOrgContext(async (session) => {
    const denied = await denyUnless(session, "team_chat:view");
    if (denied) return denied;
    const payload = await listColleagues(viewerOf(session));
    return NextResponse.json(payload);
  });
}
