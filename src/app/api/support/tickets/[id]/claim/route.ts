import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { claimTicket, isSupportAgent, type SupportViewer } from "@/services/support/tickets";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    const { id } = await params;
    const viewer: SupportViewer = {
      userId: session.user.id,
      organizationId: session.user.organizationId!,
      role: session.user.role ?? null,
    };
    if (!(await isSupportAgent(viewer))) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }
    const ticket = await claimTicket(viewer, id);
    return NextResponse.json(ticket);
  });
}
