import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluateTrigger, type AutomationJobContext } from "@/services/automations";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const trace: string[] = [];
  const log = (msg: string) => {
    trace.push(`[${new Date().toISOString()}] ${msg}`);
  };

  try {
    const body = (await request.json()) as { automationId?: string; contactId?: string };
    const automationId = body.automationId;

    log("=== INÍCIO DO TESTE DE AUTOMAÇÃO ===");

    // 1. Find automation
    let automation;
    if (automationId) {
      automation = await prisma.automation.findUnique({
        where: { id: automationId },
        include: { steps: { orderBy: { position: "asc" } } },
      });
    } else {
      automation = await prisma.automation.findFirst({
        where: { active: true, triggerType: "message_received" },
        include: { steps: { orderBy: { position: "asc" } } },
      });
    }

    if (!automation) {
      log("FALHA: Nenhuma automação encontrada");
      return NextResponse.json({ ok: false, trace });
    }
    log(`Automação encontrada: "${automation.name}" (${automation.id})`);
    log(`  active=${automation.active} triggerType=${automation.triggerType}`);
    log(`  triggerConfig=${JSON.stringify(automation.triggerConfig)}`);
    log(`  steps=${automation.steps.length}: ${automation.steps.map((s) => `${s.position}:${s.type}`).join(", ")}`);

    // 2. Find a test contact
    let contactId = body.contactId;
    if (!contactId) {
      const contact = await prisma.contact.findFirst({
        where: { phone: { not: null } },
        select: { id: true, name: true, phone: true },
        orderBy: { updatedAt: "desc" },
      });
      if (!contact) {
        log("FALHA: Nenhum contato com telefone encontrado para teste");
        return NextResponse.json({ ok: false, trace });
      }
      contactId = contact.id;
      log(`Contato de teste: "${contact.name}" (${contact.id}) phone=${contact.phone}`);
    } else {
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { id: true, name: true, phone: true },
      });
      log(`Contato: "${contact?.name ?? "?"}" (${contactId}) phone=${contact?.phone ?? "?"}`);
    }

    // 3. Evaluate trigger
    const context: AutomationJobContext = {
      contactId,
      event: "message_received",
      data: { channel: "WhatsApp", content: "Teste de automação", conversationId: "test" },
    };

    log("--- Avaliando trigger ---");
    const passes = evaluateTrigger(automation.triggerType, automation.triggerConfig, {
      ...context,
      event: "message_received",
    });
    log(`evaluateTrigger resultado: ${passes ? "PASSED ✓" : "BLOCKED ✗"}`);

    if (!passes) {
      log("PAROU AQUI: trigger não passou na avaliação");
      return NextResponse.json({ ok: false, trace });
    }

    // 4. Test enqueue (inline execution)
    log("--- Testando execução inline ---");
    const logsBefore = await prisma.automationLog.count({ where: { automationId: automation.id } });
    log(`Logs antes da execução: ${logsBefore}`);

    log("Importando automation-executor...");
    let runAutomationInline: (typeof import("@/services/automation-executor"))["runAutomationInline"];
    try {
      const mod = await import("@/services/automation-executor");
      runAutomationInline = mod.runAutomationInline;
      log("Import OK ✓");
    } catch (importErr) {
      log(`FALHA no import: ${importErr instanceof Error ? importErr.message : String(importErr)}`);
      log(`Stack: ${importErr instanceof Error ? importErr.stack?.slice(0, 500) : ""}`);
      return NextResponse.json({ ok: false, trace });
    }

    log("Executando runAutomationInline...");
    const startMs = Date.now();
    try {
      await runAutomationInline({
        automationId: automation.id,
        context,
      });
      log(`Execução concluída em ${Date.now() - startMs}ms ✓`);
    } catch (execErr) {
      log(`FALHA na execução (${Date.now() - startMs}ms): ${execErr instanceof Error ? execErr.message : String(execErr)}`);
      log(`Stack: ${execErr instanceof Error ? execErr.stack?.slice(0, 500) : ""}`);
    }

    // 5. Check logs after
    const logsAfter = await prisma.automationLog.count({ where: { automationId: automation.id } });
    log(`Logs depois da execução: ${logsAfter} (novos: ${logsAfter - logsBefore})`);

    if (logsAfter > logsBefore) {
      const newLogs = await prisma.automationLog.findMany({
        where: { automationId: automation.id },
        orderBy: { executedAt: "desc" },
        take: logsAfter - logsBefore,
      });
      for (const l of newLogs) {
        log(`  LOG: [${l.status}] ${l.message?.slice(0, 200) ?? "—"}`);
      }
    }

    log("=== FIM DO TESTE ===");
    return NextResponse.json({ ok: logsAfter > logsBefore, trace });
  } catch (e) {
    log(`ERRO FATAL: ${e instanceof Error ? e.message : String(e)}`);
    log(`Stack: ${e instanceof Error ? e.stack?.slice(0, 500) : ""}`);
    return NextResponse.json({ ok: false, trace }, { status: 500 });
  }
}
