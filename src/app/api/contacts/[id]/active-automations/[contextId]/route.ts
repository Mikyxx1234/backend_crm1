import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { cancelContext } from "@/services/automation-context";

type Ctx = { params: Promise<{ id: string; contextId: string }> };

/**
 * DELETE /api/contacts/:id/active-automations/:contextId
 *
 * Interrompe manualmente um robô em execução para o contato. O scope de
 * org é aplicado pela Prisma extension (withOrgContext); ainda assim
 * validamos que o contexto pertence ao contato da rota antes de cancelar.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id, contextId } = await ctx.params;
      const row = await prisma.automationContext.findUnique({
        where: { id: contextId },
        select: { id: true, contactId: true },
      });
      if (!row || row.contactId !== id) {
        return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
      }
      const cancelled = await cancelContext(contextId);
      if (!cancelled) {
        return NextResponse.json({ message: "Automação já finalizada." }, { status: 409 });
      }
      return NextResponse.json({ ok: true, contextId });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao interromper automação." },
        { status: 500 },
      );
    }
  });
}
