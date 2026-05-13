/**
 * GET /api/automations/audit
 *
 * Relatório agregado de todas as automações (ativas por padrão).
 * Usado pela página `/automations/audit` para o dashboard de saúde.
 *
 * Query:
 *   - includeInactive=true → audita inclusive as inativas (default: só ativas)
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  auditAutomation,
  detectCrossConflictCandidates,
  type AutomationLike,
} from "@/lib/automation-auditor";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const includeInactive = url.searchParams.get("includeInactive") === "true";

    const where = includeInactive ? undefined : { active: true };
    const automations = await prisma.automation.findMany({
      where,
      include: { steps: { orderBy: { position: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });

    const likes: AutomationLike[] = automations.map((a) => ({
      id: a.id,
      name: a.name,
      triggerType: a.triggerType,
      triggerConfig: a.triggerConfig,
      active: a.active,
      steps: a.steps.map((s) => ({ id: s.id, type: s.type, config: s.config })),
    }));

    const reports = likes.map((a) => auditAutomation(a));
    const crossConflicts = detectCrossConflictCandidates(likes);

    // Resumo agregado — mais útil pro header da página que um total cru.
    const totals = reports.reduce(
      (acc, r) => {
        acc.errors += r.errorCount;
        acc.warnings += r.warningCount;
        acc.infos += r.infoCount;
        return acc;
      },
      { errors: 0, warnings: 0, infos: 0 },
    );

    return NextResponse.json({
      automationsCount: reports.length,
      totals,
      reports,
      crossConflicts,
    });
  } catch (e) {
    console.error("[audit global]", e);
    return NextResponse.json(
      { message: "Erro ao auditar automações." },
      { status: 500 },
    );
  }
}
