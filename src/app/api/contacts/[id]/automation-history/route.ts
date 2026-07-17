import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getContactAutomationHistory } from "@/services/automation-context";

type Ctx = { params: Promise<{ id: string }> };

export type AutomationHistoryDto = {
  contextId: string;
  automationId: string;
  name: string;
  status: "COMPLETED" | "TIMED_OUT";
  startedAt: string;
  finishedAt: string;
};

/**
 * GET /api/contacts/:id/automation-history
 *
 * Execuções encerradas (COMPLETED/TIMED_OUT) do contato — seção
 * "Histórico" do card de automações (inbox e deal).
 */
export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id } = await ctx.params;
      const rows = await getContactAutomationHistory(id);
      const items: AutomationHistoryDto[] = rows.map((r) => ({
        contextId: r.id,
        automationId: r.automationId,
        name: r.automation.name,
        status: r.status as "COMPLETED" | "TIMED_OUT",
        startedAt: r.createdAt.toISOString(),
        finishedAt: r.updatedAt.toISOString(),
      }));
      return NextResponse.json({ items });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao buscar histórico de automações." },
        { status: 500 },
      );
    }
  });
}
