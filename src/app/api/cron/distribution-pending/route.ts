/**
 * GET /api/cron/distribution-pending
 *
 * Job de segurança: drena a fila "Aguardando distribuição" de todas as
 * organizações com o widget `smart_distribution` ativo.
 *
 * Cobre casos em que ninguém mudou de status (ex.: horário de expediente
 * começou, limite de fila liberou por timeout, presença já estava ONLINE).
 *
 * Autenticação: `Authorization: Bearer ${CRON_SECRET}` ou `?secret=`.
 *
 * Como agendar (EasyPanel > Scheduled Service):
 *   Schedule: every 1 minute
 *   Command:  curl -fsS "https://BACKEND/api/cron/distribution-pending?secret=$CRON_SECRET"
 *
 * Sem migration / sem tabela nova — só código.
 */

import { NextResponse } from "next/server";

import { prismaBase } from "@/lib/prisma-base";
import { runWithContext } from "@/lib/request-context";
import { processPendingDistributionQueue } from "@/services/distribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET?.trim();
    if (!expected) {
      return NextResponse.json(
        { ok: false, message: "CRON_SECRET nao configurado." },
        { status: 503 },
      );
    }

    const url = new URL(request.url);
    const headerSecret = (request.headers.get("authorization") ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const provided =
      headerSecret || (url.searchParams.get("secret")?.trim() ?? "");
    if (!provided || provided !== expected) {
      return NextResponse.json(
        { ok: false, message: "Cron secret invalido." },
        { status: 401 },
      );
    }

    const orgs = await prismaBase.organizationWidget.findMany({
      where: { widgetSlug: "smart_distribution", status: "ACTIVE" },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });

    const results: Array<{
      organizationId: string;
      resolved: number;
      pending: number;
    }> = [];

    for (const { organizationId } of orgs) {
      try {
        const drain = await runWithContext(
          {
            organizationId,
            userId: "system",
            isSuperAdmin: false,
            actor: {
              type: "SYSTEM",
              label: "Distribuição Inteligente",
              sublabel: "cron:distribution-pending",
            },
          },
          () => processPendingDistributionQueue({ trigger: "scheduled" }),
        );
        results.push({
          organizationId,
          resolved: drain.resolved,
          pending: drain.pending,
        });
      } catch (e) {
        console.error(
          "[cron/distribution-pending] org failed",
          organizationId,
          e,
        );
        results.push({ organizationId, resolved: 0, pending: -1 });
      }
    }

    const resolvedTotal = results.reduce((s, r) => s + Math.max(0, r.resolved), 0);

    return NextResponse.json({
      ok: true,
      orgs: orgs.length,
      resolvedTotal,
      results,
    });
  } catch (e) {
    console.error("[cron/distribution-pending]", e);
    return NextResponse.json(
      { ok: false, message: "Erro no cron de distribuição." },
      { status: 500 },
    );
  }
}
