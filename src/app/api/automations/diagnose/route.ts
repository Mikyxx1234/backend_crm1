import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const checks: Record<string, unknown> = {};

    const automations = await prisma.automation.findMany({
      where: { active: true },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    checks.activeAutomations = automations.map((a) => ({
      id: a.id,
      name: a.name,
      triggerType: a.triggerType,
      triggerConfig: a.triggerConfig,
      stepsCount: a.steps.length,
      steps: a.steps.map((s) => ({
        id: s.id,
        type: s.type,
        position: s.position,
        configKeys: Object.keys(
          typeof s.config === "object" && s.config !== null ? s.config : {}
        ),
      })),
    }));

    const messageReceivedCount = automations.filter(
      (a) => a.triggerType === "message_received"
    ).length;
    checks.messageReceivedAutomations = messageReceivedCount;

    let tableExists = false;
    let tableColumns: string[] = [];
    try {
      const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'automation_logs' ORDER BY ordinal_position`
      );
      tableExists = true;
      tableColumns = cols.map((c) => c.column_name);
    } catch {
      tableExists = false;
    }
    checks.automationLogsTable = {
      exists: tableExists,
      columns: tableColumns,
      hasStepId: tableColumns.includes("stepId"),
      hasStepType: tableColumns.includes("stepType"),
    };

    let logCount = 0;
    let recentLogs: unknown[] = [];
    if (tableExists) {
      logCount = await prisma.automationLog.count();
      recentLogs = await prisma.automationLog.findMany({
        orderBy: { executedAt: "desc" },
        take: 10,
      });
    }
    checks.logs = { total: logCount, recent: recentLogs };

    let writeTestOk = false;
    let writeTestError: string | null = null;
    if (tableExists) {
      try {
        const testLog = await prisma.automationLog.create({
          data: {
            automationId: "DIAG_TEST",
            status: "DIAG_TEST",
            message: `Teste de escrita em ${new Date().toISOString()}`,
            stepId: "test",
            stepType: "test",
          },
        });
        await prisma.automationLog.delete({ where: { id: testLog.id } });
        writeTestOk = true;
      } catch (err) {
        writeTestError = err instanceof Error ? err.message : String(err);
        try {
          const testLog2 = await prisma.automationLog.create({
            data: {
              automationId: "DIAG_TEST",
              status: "DIAG_TEST",
              message: `Teste de escrita (sem stepId) em ${new Date().toISOString()}`,
            },
          });
          await prisma.automationLog.delete({ where: { id: testLog2.id } });
          writeTestOk = true;
          writeTestError = `stepId/stepType columns failed but base write OK: ${writeTestError}`;
        } catch (err2) {
          writeTestError = `ALL writes failed: ${writeTestError} | base: ${err2 instanceof Error ? err2.message : String(err2)}`;
        }
      }
    }
    checks.writeTest = { ok: writeTestOk, error: writeTestError };

    checks.env = {
      META_WHATSAPP_ACCESS_TOKEN: process.env.META_WHATSAPP_ACCESS_TOKEN
        ? "SET"
        : "MISSING",
      META_WHATSAPP_PHONE_NUMBER_ID: process.env.META_WHATSAPP_PHONE_NUMBER_ID
        ? "SET"
        : "MISSING",
      AUTOMATION_WORKER_MODE:
        process.env.AUTOMATION_WORKER_MODE ?? "(não definido — inline)",
      REDIS_URL: process.env.REDIS_URL ? "SET" : "MISSING",
    };

    return NextResponse.json(checks);
  } catch (e) {
    console.error("Diagnose error:", e);
    return NextResponse.json(
      { message: "Erro no diagnóstico.", error: String(e) },
      { status: 500 }
    );
  }
}
