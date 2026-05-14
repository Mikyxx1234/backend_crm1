import type { Prisma } from "@prisma/client";

import { getLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
// prismaBase + withSystemContext usados apenas em sweepExpiredTimeouts
// (cross-tenant). Os outros helpers deste arquivo sao chamados de
// API routes / webhooks que ja tem contexto montado.
import { prismaBase } from "@/lib/prisma-base";
import { withSystemContext } from "@/lib/webhook-context";

const log = getLogger("automation-context");

function readNumber(cfg: unknown, key: string): number | undefined {
  if (!cfg || typeof cfg !== "object") return undefined;
  const v = (cfg as Record<string, unknown>)[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Tipos de step que PAUSAM o fluxo aguardando próxima mensagem do contato.
 * Ao TRANSICIONAR pra um deles via processIncomingMessage, precisamos:
 *  1. Setar `currentStepId = step.id`
 *  2. Setar `timeoutAt` se o step tem `timeoutMs` configurado (cronômetro)
 *  3. NÃO chamar continueFromStep (esses steps pausam o fluxo)
 */
const PAUSING_STEP_TYPES = new Set([
  "question",
  "send_whatsapp_interactive",
  "wait_for_reply",
]);

export async function getActiveContext(automationId: string, contactId: string) {
  return prisma.automationContext.findFirst({
    where: {
      automationId,
      contactId,
      status: "RUNNING",
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createContext(
  automationId: string,
  contactId: string,
  firstStepId: string,
  timeoutMs?: number,
) {
  return prisma.automationContext.create({
    data: withOrgFromCtx({
      automationId,
      contactId,
      currentStepId: firstStepId,
      variables: {},
      status: "RUNNING" as const,
      timeoutAt: timeoutMs && timeoutMs > 0 ? new Date(Date.now() + timeoutMs) : null,
    }),
  });
}

export async function advanceContext(
  contextId: string,
  nextStepId: string | null,
  variables: Record<string, unknown>,
  timeoutMs?: number,
) {
  const vars = variables as Prisma.InputJsonValue;

  if (!nextStepId) {
    return prisma.automationContext.update({
      where: { id: contextId },
      data: { status: "COMPLETED", variables: vars, currentStepId: null, timeoutAt: null },
    });
  }

  return prisma.automationContext.update({
    where: { id: contextId },
    data: {
      currentStepId: nextStepId,
      variables: vars,
      timeoutAt: timeoutMs && timeoutMs > 0 ? new Date(Date.now() + timeoutMs) : null,
    },
  });
}

export async function pauseContext(contextId: string) {
  return prisma.automationContext.update({
    where: { id: contextId },
    data: { status: "PAUSED" },
  });
}

export async function timeoutContext(contextId: string) {
  return prisma.automationContext.update({
    where: { id: contextId },
    data: { status: "TIMED_OUT", timeoutAt: null },
  });
}

export async function getContactActiveContexts(contactId: string) {
  return prisma.automationContext.findMany({
    where: { contactId, status: { in: ["RUNNING", "PAUSED"] } },
    include: {
      automation: { select: { id: true, name: true, steps: { orderBy: { position: "asc" } } } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function processIncomingMessage(contactId: string, messageContent: string) {
  const activeContexts = await getContactActiveContexts(contactId);

  log.debug(
    `processIncomingMessage contactId=${contactId} contexts=${activeContexts.length} msg="${messageContent.slice(0, 40)}"`,
  );

  for (const ctx of activeContexts) {
    if (!ctx.currentStepId) {
      log.debug(`ctx ${ctx.id} (auto=${ctx.automation.name}) sem currentStepId — skip`);
      continue;
    }

    const currentStep = ctx.automation.steps.find((s) => s.id === ctx.currentStepId);
    if (!currentStep) {
      log.warn(
        `ctx ${ctx.id} (auto=${ctx.automation.name}) currentStepId=${ctx.currentStepId} não existe na automação — marcando como COMPLETED`,
      );
      // Step apagado da automação: limpa o contexto orfão pra não bloquear
      // futuras execuções (estado morto vivo era uma reclamação recorrente).
      await advanceContext(ctx.id, null, (ctx.variables as Record<string, unknown>) ?? {});
      continue;
    }
    if (!PAUSING_STEP_TYPES.has(currentStep.type)) {
      log.debug(
        `ctx ${ctx.id} (auto=${ctx.automation.name}) currentStep=${currentStep.type} não é interativo — skip`,
      );
      continue;
    }

    const config = currentStep.config as Record<string, unknown>;
    let nextStepId: string | null = null;
    let variables = { ...(ctx.variables as Record<string, unknown>) };

    if (currentStep.type === "wait_for_reply") {
      const varName = String(config.saveToVariable ?? "lastResponse").trim();
      if (varName) {
        variables = { ...variables, [varName]: messageContent };
      }
      const receivedGoto =
        typeof config.receivedGotoStepId === "string" && config.receivedGotoStepId !== ""
          ? (config.receivedGotoStepId as string)
          : null;
      if (receivedGoto) {
        nextStepId = receivedGoto;
        log.info(
          `wait_for_reply resolvido — auto=${ctx.automation.name} contato=${contactId} → step=${nextStepId} (via receivedGotoStepId)`,
        );
      } else {
        // Fallback: avança linearmente para o próximo step
        const stepIndex = ctx.automation.steps.findIndex((s) => s.id === ctx.currentStepId);
        nextStepId = ctx.automation.steps[stepIndex + 1]?.id ?? null;
        log.info(
          `wait_for_reply sem receivedGotoStepId — auto=${ctx.automation.name} → fallback linear step=${nextStepId ?? "(fim)"}`,
        );
      }
    } else {
      const varName = String(config.saveToVariable ?? "lastResponse");
      variables = { ...variables, [varName]: messageContent };

      const buttons = Array.isArray(config.buttons)
        ? (config.buttons as { text?: string; title?: string; id?: string; gotoStepId?: string }[])
        : [];

      if (buttons.length > 0) {
        const normalized = messageContent.trim().toLowerCase();
        const matchedBtn = buttons.find((b) => {
          const label = (b.title || b.text || "").trim().toLowerCase();
          const btnId = (b.id || "").trim().toLowerCase();
          return label === normalized || btnId === normalized;
        });

        if (matchedBtn && matchedBtn.gotoStepId) {
          nextStepId = matchedBtn.gotoStepId;
          log.info(
            `botão "${matchedBtn.title || matchedBtn.text}" matched — auto=${ctx.automation.name} → step=${nextStepId}`,
          );
        } else if (
          typeof config.elseGotoStepId === "string" &&
          config.elseGotoStepId !== ""
        ) {
          nextStepId = config.elseGotoStepId;
          log.info(
            `nenhum botão matched ("${normalized}") — auto=${ctx.automation.name} → fallback elseGotoStepId step=${nextStepId}`,
          );
        } else {
          const stepIndex = ctx.automation.steps.findIndex((s) => s.id === ctx.currentStepId);
          nextStepId = ctx.automation.steps[stepIndex + 1]?.id ?? null;
          log.info(
            `nenhum botão matched ("${normalized}") + sem elseGotoStepId — auto=${ctx.automation.name} → fallback linear step=${nextStepId ?? "(fim)"}`,
          );
        }
      } else {
        const stepIndex = ctx.automation.steps.findIndex((s) => s.id === ctx.currentStepId);
        nextStepId = ctx.automation.steps[stepIndex + 1]?.id ?? null;
        log.info(
          `question sem botões — auto=${ctx.automation.name} → step=${nextStepId ?? "(fim)"}`,
        );
      }
    }

    if (nextStepId) {
      // Resolve em cascata qualquer `wait_for_reply` encadeado: a mesma
      // mensagem que acabou de chegar CONTA como "resposta recebida" para
      // TODO wait_for_reply subsequente, até achar um step não-pausante,
      // um step pausante que EXIGE nova interação (question/interactive),
      // um `finish` ou um ramo órfão. Isso é o comportamento esperado
      // pelo usuário: "independente de quantas pausas existirem, a
      // resposta do cliente deve fazer o fluxo seguir".
      let currentTargetId: string = nextStepId;
      let cascade = 0;
      const CASCADE_LIMIT = 20;

      while (cascade++ < CASCADE_LIMIT) {
        const targetStep = ctx.automation.steps.find((s) => s.id === currentTargetId);
        if (!targetStep) {
          log.warn(
            `nextStepId=${currentTargetId} não existe na automação ${ctx.automation.name} — fechando contexto`,
          );
          await advanceContext(ctx.id, null, variables);
          return { handled: true, automationId: ctx.automationId, contextId: ctx.id };
        }
        if (targetStep.type === "finish") {
          await advanceContext(ctx.id, null, variables);
          log.info(`fluxo finalizado — auto=${ctx.automation.name} contato=${contactId}`);
          return { handled: true, automationId: ctx.automationId, contextId: ctx.id };
        }

        if (targetStep.type === "wait_for_reply") {
          const cfg = targetStep.config as Record<string, unknown>;
          const receivedGoto =
            typeof cfg.receivedGotoStepId === "string" && cfg.receivedGotoStepId !== ""
              ? (cfg.receivedGotoStepId as string)
              : null;
          if (!receivedGoto) {
            // Fallback: avança linearmente para o próximo step na cascata
            const stepIdx = ctx.automation.steps.findIndex((s) => s.id === targetStep.id);
            currentTargetId = ctx.automation.steps[stepIdx + 1]?.id ?? "";
            if (!currentTargetId) {
              await advanceContext(ctx.id, null, variables);
              return { handled: true, automationId: ctx.automationId, contextId: ctx.id };
            }
            log.info(
              `wait_for_reply (cascata) sem receivedGotoStepId — auto=${ctx.automation.name} → fallback linear step=${currentTargetId}`,
            );
            continue;
          }
          log.info(
            `wait_for_reply resolvido em cascata — auto=${ctx.automation.name} contato=${contactId} step=${targetStep.id} → step=${receivedGoto}`,
          );
          currentTargetId = receivedGoto;
          continue;
        }

        // Aqui paramos a cascata: targetStep é ou não-pausante (action)
        // ou pausante que precisa ENVIAR algo antes de esperar
        // (question, send_whatsapp_interactive). Propaga timeoutMs se
        // aplicável.
        const targetTimeoutMs = PAUSING_STEP_TYPES.has(targetStep.type)
          ? readNumber(targetStep.config, "timeoutMs")
          : undefined;

        await advanceContext(ctx.id, currentTargetId, variables, targetTimeoutMs);

        try {
          const { continueFromStep } = await import("@/services/automation-executor");
          await continueFromStep(ctx.automationId, contactId, currentTargetId, variables);
          if (PAUSING_STEP_TYPES.has(targetStep.type)) {
            log.info(
              `próximo step (${targetStep.type}) executado e pausou o fluxo — auto=${ctx.automation.name} timeoutMs=${targetTimeoutMs ?? "—"}`,
            );
          }
        } catch (err) {
          log.error(
            `continueFromStep error — auto=${ctx.automation.name} step=${currentTargetId}:`,
            err,
          );
        }
        break;
      }

      if (cascade >= CASCADE_LIMIT) {
        log.warn(
          `cascata de wait_for_reply excedeu ${CASCADE_LIMIT} saltos — auto=${ctx.automation.name} → fechando contexto (possível loop de configuração)`,
        );
        await advanceContext(ctx.id, null, variables);
        return { handled: true, automationId: ctx.automationId, contextId: ctx.id };
      }
    } else {
      // nextStepId nulo: encerra o contexto (não cai em fallback de array
      // pra evitar disparar passos de outros ramos por engano).
      await advanceContext(ctx.id, null, variables);
      log.info(`fluxo finalizado (sem próximo) — auto=${ctx.automation.name} contato=${contactId}`);
    }

    return { handled: true, automationId: ctx.automationId, contextId: ctx.id };
  }

  log.debug(`nenhum contexto interativo encontrado pra contato=${contactId}`);
  return { handled: false };
}

async function dispatchToNextStep(
  ctx: { id: string; automationId: string; contactId: string | null; automation: { name?: string; steps: { id: string; type: string; config: unknown }[] } },
  nextStepId: string | null,
  variables: Record<string, unknown>,
  reason: string,
): Promise<void> {
  if (!nextStepId) {
    await advanceContext(ctx.id, null, variables);
    log.info(`fluxo finalizado (sem próximo, ${reason}) — auto=${ctx.automation.name ?? ctx.automationId}`);
    return;
  }

  const targetStep = ctx.automation.steps.find((s) => s.id === nextStepId);
  if (!targetStep) {
    log.warn(
      `nextStepId=${nextStepId} não existe (${reason}) — auto=${ctx.automation.name ?? ctx.automationId} → fechando contexto`,
    );
    await advanceContext(ctx.id, null, variables);
    return;
  }
  if (targetStep.type === "finish") {
    await advanceContext(ctx.id, null, variables);
    log.info(`fluxo finalizado (${reason}) — auto=${ctx.automation.name ?? ctx.automationId}`);
    return;
  }

  const targetTimeoutMs = PAUSING_STEP_TYPES.has(targetStep.type)
    ? readNumber(targetStep.config, "timeoutMs")
    : undefined;

  await advanceContext(ctx.id, nextStepId, variables, targetTimeoutMs);

  if (ctx.contactId) {
    try {
      const { continueFromStep } = await import("@/services/automation-executor");
      await continueFromStep(ctx.automationId, ctx.contactId, nextStepId, variables);
      if (PAUSING_STEP_TYPES.has(targetStep.type)) {
        log.info(
          `próximo step pausa (${targetStep.type}, ${reason}) e foi executado — auto=${ctx.automation.name ?? ctx.automationId} timeoutMs=${targetTimeoutMs ?? "—"}`,
        );
      }
    } catch (err) {
      log.error(
        `continueFromStep error (${reason}) — auto=${ctx.automation.name ?? ctx.automationId} step=${nextStepId}:`,
        err,
      );
    }
  } else if (PAUSING_STEP_TYPES.has(targetStep.type)) {
    log.info(
      `próximo step pausa (${targetStep.type}, ${reason}) sem contactId — auto=${ctx.automation.name ?? ctx.automationId} timeoutMs=${targetTimeoutMs ?? "—"}`,
    );
  }
}

export async function processTimeout(contextId: string) {
  const ctx = await prisma.automationContext.findUnique({
    where: { id: contextId },
    include: {
      automation: { select: { id: true, name: true, steps: { orderBy: { position: "asc" } } } },
    },
  });
  if (!ctx || ctx.status !== "RUNNING" || !ctx.currentStepId) {
    log.debug(`processTimeout — ctx ${contextId} inativo/sem step, ignorando`);
    return;
  }

  const step = ctx.automation.steps.find((s) => s.id === ctx.currentStepId);
  if (!step || !PAUSING_STEP_TYPES.has(step.type)) {
    log.debug(
      `processTimeout — ctx ${contextId} step=${step?.type ?? "?"} não é interativo, ignorando`,
    );
    return;
  }

  const config = step.config as Record<string, unknown>;
  const variables = (ctx.variables as Record<string, unknown>) ?? {};
  const ctxForDispatch = {
    id: ctx.id,
    automationId: ctx.automationId,
    contactId: ctx.contactId,
    automation: ctx.automation,
  };

  if (step.type === "wait_for_reply") {
    const timeoutGoto =
      typeof config.timeoutGotoStepId === "string" && config.timeoutGotoStepId !== ""
        ? (config.timeoutGotoStepId as string)
        : null;
    if (!timeoutGoto) {
      log.warn(
        `wait_for_reply timeout sem timeoutGotoStepId — auto=${ctx.automation.name} step=${step.id} → fechando contexto`,
      );
      await advanceContext(ctx.id, null, variables);
      return;
    }
    log.info(
      `wait_for_reply timeout — auto=${ctx.automation.name} contato=${ctx.contactId} → step=${timeoutGoto}`,
    );
    await dispatchToNextStep(ctxForDispatch, timeoutGoto, variables, "wait_for_reply timeout");
    return;
  }

  const action = String(config.timeoutAction ?? "continue");

  if (action === "stop") {
    log.info(`question/interactive timeout (action=stop) — auto=${ctx.automation.name}`);
    await advanceContext(ctx.id, null, variables);
    return;
  }

  let nextStepId: string | null = null;

  if (action === "goto" && typeof config.timeoutGotoStepId === "string" && config.timeoutGotoStepId) {
    nextStepId = config.timeoutGotoStepId;
  } else {
    const stepIndex = ctx.automation.steps.findIndex((s) => s.id === ctx.currentStepId);
    nextStepId = ctx.automation.steps[stepIndex + 1]?.id ?? null;
  }

  log.info(
    `question/interactive timeout — auto=${ctx.automation.name} action=${action} → step=${nextStepId ?? "(fim)"}`,
  );
  await dispatchToNextStep(ctxForDispatch, nextStepId, variables, `${step.type} timeout`);
}

function applyVariableTransform(raw: unknown, transform?: string): string {
  const value = raw == null ? "" : String(raw);
  if (!transform) return value;
  const t = transform.trim().toLowerCase();
  if (t === "first" || t === "first_name" || t === "primeiro_nome") {
    return value.trim().split(/\s+/)[0] ?? "";
  }
  return value;
}

export function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([a-zA-Z0-9_]+))?\s*\}\}/g,
    (_, key: string, transform?: string) => {
      const val = variables[key];
      if (val == null) {
        return transform ? `{{${key}|${transform}}}` : `{{${key}}}`;
      }
      return applyVariableTransform(val, transform);
    },
  );
}

export async function sweepExpiredTimeouts(): Promise<number> {
  // Worker cross-tenant: lista contextos expirados de TODAS as orgs
  // usando prismaBase (sem scope). Cada processamento entra em seu
  // proprio withSystemContext.
  const expired = await prismaBase.automationContext.findMany({
    where: {
      status: "RUNNING",
      timeoutAt: { not: null, lte: new Date() },
    },
    select: { id: true, organizationId: true },
    take: 50,
  });
  let processed = 0;
  for (const ctx of expired) {
    try {
      await withSystemContext(ctx.organizationId, () => processTimeout(ctx.id));
      processed++;
    } catch (err) {
      console.error(`[automation-context] sweepExpiredTimeouts error for ${ctx.id}:`, err);
    }
  }
  return processed;
}

let _sweepInterval: ReturnType<typeof setInterval> | null = null;

export function startTimeoutSweeper(intervalMs = 30_000) {
  if (_sweepInterval) return;
  _sweepInterval = setInterval(() => {
    sweepExpiredTimeouts().catch((err) =>
      console.error("[automation-context] sweeper error:", err)
    );
  }, intervalMs);
  if (typeof _sweepInterval === "object" && "unref" in _sweepInterval) {
    (_sweepInterval as NodeJS.Timeout).unref();
  }
  console.info(`[automation-context] timeout sweeper started (every ${intervalMs}ms)`);
}

export function stopTimeoutSweeper() {
  if (_sweepInterval) {
    clearInterval(_sweepInterval);
    _sweepInterval = null;
  }
}
