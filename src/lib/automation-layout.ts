import type { AutomationStep } from "@/lib/automation-workflow";

const NONE = "__none__";
const START_X = 200;
const GAP_X = 300;
const START_Y = 140;
const GAP_Y = 170;

function isRealTarget(target: unknown, stepIds: Set<string>): target is string {
  return typeof target === "string" && target !== "" && target !== NONE && stepIds.has(target);
}

function outgoingTargets(step: AutomationStep, stepIds: Set<string>): string[] {
  const cfg = (step.config ?? {}) as Record<string, unknown>;
  const out: string[] = [];

  const push = (v: unknown) => {
    if (isRealTarget(v, stepIds) && !out.includes(v)) out.push(v);
  };

  if (step.type === "condition") {
    const branches = Array.isArray(cfg.branches) ? (cfg.branches as Record<string, unknown>[]) : [];
    for (const b of branches) push(b.nextStepId);
    push(cfg.elseStepId);
    return out;
  }

  if (step.type === "wait_for_reply") {
    push(cfg.receivedGotoStepId);
    push(cfg.timeoutGotoStepId);
    return out;
  }

  if (step.type === "business_hours") {
    push(cfg.elseStepId);
  }

  const buttons = Array.isArray(cfg.buttons) ? (cfg.buttons as Record<string, unknown>[]) : [];
  for (const b of buttons) push(b.gotoStepId);
  push(cfg.elseGotoStepId);
  push(cfg.timeoutGotoStepId);
  push(cfg.nextStepId);

  return out;
}

/**
 * Auto-organiza o fluxo preservando a lógica das conexões:
 * - X por profundidade (distância dos nós raiz)
 * - Y por ordem estável de descoberta (evita sobreposição)
 */
export function autoAlignWorkflowSteps(steps: AutomationStep[]): AutomationStep[] {
  if (steps.length <= 1) return steps;

  const idsInOrder = steps.map((s) => s.id);
  const stepIds = new Set(idsInOrder);
  const indexById = new Map(idsInOrder.map((id, i) => [id, i]));

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of idsInOrder) indegree.set(id, 0);

  for (const step of steps) {
    const out = outgoingTargets(step, stepIds);
    outgoing.set(step.id, out);
    for (const tgt of out) indegree.set(tgt, (indegree.get(tgt) ?? 0) + 1);
  }

  const roots = idsInOrder.filter((id, i) => i === 0 || (indegree.get(id) ?? 0) === 0);
  const queue: string[] = [...roots];
  const depth = new Map<string, number>(roots.map((id) => [id, 0]));
  const seen = new Set(queue);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    const out = outgoing.get(id) ?? [];
    for (const tgt of out) {
      const prev = depth.get(tgt);
      if (prev == null || d + 1 < prev) depth.set(tgt, d + 1);
      if (!seen.has(tgt)) {
        seen.add(tgt);
        queue.push(tgt);
      }
    }
  }

  const maxDepth = Math.max(0, ...depth.values());
  for (const id of idsInOrder) {
    if (!depth.has(id)) depth.set(id, maxDepth + 1 + (indexById.get(id) ?? 0));
  }

  const laneOrder: string[] = [];
  const laneSeen = new Set<string>();
  const dfs = (id: string) => {
    if (laneSeen.has(id)) return;
    laneSeen.add(id);
    laneOrder.push(id);
    const out = outgoing.get(id) ?? [];
    for (const tgt of out) dfs(tgt);
  };
  for (const root of roots) dfs(root);
  for (const id of idsInOrder) {
    if (!laneSeen.has(id)) laneOrder.push(id);
  }

  const laneById = new Map(laneOrder.map((id, i) => [id, i]));

  return steps.map((step) => {
    const cfg = (step.config ?? {}) as Record<string, unknown>;
    const nextCfg = { ...cfg };
    nextCfg.__rfPos = {
      x: START_X + (depth.get(step.id) ?? 0) * GAP_X,
      y: START_Y + (laneById.get(step.id) ?? 0) * GAP_Y,
    };
    return { ...step, config: nextCfg };
  });
}

