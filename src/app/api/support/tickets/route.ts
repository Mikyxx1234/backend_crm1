import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  createTicket,
  isSupportAgent,
  listTickets,
  type SupportViewer,
} from "@/services/support/tickets";

const CreateSchema = z.object({
  category: z.string().min(1).max(60),
  description: z.string().min(1).max(4000),
});

const SCOPES = ["mine", "assigned", "queue", "all"] as const;
type Scope = (typeof SCOPES)[number];

export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    const viewer: SupportViewer = {
      userId: session.user.id,
      organizationId: session.user.organizationId!,
      role: session.user.role ?? null,
    };
    const url = new URL(request.url);
    const raw = url.searchParams.get("scope") ?? "mine";
    const scope: Scope = (SCOPES as readonly string[]).includes(raw)
      ? (raw as Scope)
      : "mine";

    if (scope !== "mine") {
      const agent = await isSupportAgent(viewer);
      if (!agent) {
        return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
      }
    }
    const tickets = await listTickets(viewer, scope);
    return NextResponse.json(tickets);
  });
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const body = await request.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", errors: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const viewer: SupportViewer = {
      userId: session.user.id,
      organizationId: session.user.organizationId!,
      role: session.user.role ?? null,
    };
    const ticket = await createTicket(viewer, parsed.data);
    return NextResponse.json(ticket, { status: 201 });
  });
}
