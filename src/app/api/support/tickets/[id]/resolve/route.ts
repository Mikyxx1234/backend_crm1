import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  getTicketForViewer,
  resolveTicket,
  type SupportViewer,
} from "@/services/support/tickets";

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
    const res = await getTicketForViewer(viewer, id);
    if (!res.ok) {
      return NextResponse.json(
        { message: res.code === 404 ? "Ticket não encontrado." : "Acesso negado." },
        { status: res.code },
      );
    }
    const ticket = await resolveTicket(viewer, id);
    return NextResponse.json(ticket);
  });
}
