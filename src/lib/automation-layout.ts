import type { AutomationStep } from "@/lib/automation-workflow";

const NONE = "__none__";
const START_X = 200;
const GAP_X = 300;
// 27/mai/26 — Alinhado com `NODE_Y` do canvas no frontend (=300) e com
// o `START_Y` espelhado em `frontend_crm1/src/lib/automation-layout.ts`.
const START_Y = 300;
const GAP_Y = 220;

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
 * Auto-organiza o fluxo preservando a lógica das conexões.
 *
 * Coordenadas:
 * - `X` por profundidade (caminho MAIS LONGO desde a raiz). Em
 *   fluxos convergentes (diamond A→B→D, A→C→D) usar shortest path
 *   colocava o nó convergente perto demais, com edge voltando pra
 *   trás. Longest path resolve.
 * - `Y` por lane: filhos herdam a lane do pai (cadeia linear vira
 *   linha horizontal), ramificações alocam lanes novas. Orphans em
 *   lanes próprias depois das principais.
 */
export function autoAlignWorkflowSteps(steps: AutomationStep[]): AutomationStep[] {
  if (steps.length <= 1) return steps;

  const idsInOrder = steps.map((s) => s.id);
  const stepIds = new Set(idsInOrder);

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of idsInOrder) indegree.set(id, 0);

  for (const step of steps) {
    const out = outgoingTargets(step, stepIds);
    outgoing.set(step.id, out);
    for (const tgt of out) indegree.set(tgt, (indegree.get(tgt) ?? 0) + 1);
  }

  const roots = idsInOrder.filter((id, i) => i === 0 || (indegree.get(id) ?? 0) === 0);

  const depth = new Map<string, number>();
  for (const r of roots) depth.set(r, 0);
  for (let iter = 0; iter < steps.length + 1; iter++) {
    let changed = false;
    for (const step of steps) {
      const d = depth.get(step.id);
      if (d == null) continue;
      const out = outgoing.get(step.id) ?? [];
      for (const tgt of out) {
        const cur = depth.get(tgt);
        if (cur == null || d + 1 > cur) {
          depth.set(tgt, d + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const reachedMax = Math.max(0, ...Array.from(depth.values()));
  const orphans: string[] = [];
  for (const id of idsInOrder) {
    if (!depth.has(id)) {
      depth.set(id, reachedMax + 1);
      orphans.push(id);
    }
  }

  const laneById = new Map<string, number>();
  let nextLane = 0;

  const assignLanes = (id: string, currentLane: number): void => {
    if (laneById.has(id)) return;
    laneById.set(id, currentLane);
    const out = outgoing.get(id) ?? [];
    if (out.length === 0) return;
    assignLanes(out[0], currentLane);
    for (let i = 1; i < out.length; i++) {
      nextLane++;
      assignLanes(out[i], nextLane);
    }
  };

  for (const root of roots) {
    if (!laneById.has(root)) {
      assignLanes(root, nextLane);
      nextLane++;
    }
  }

  for (const id of idsInOrder) {
    if (!laneById.has(id)) {
      laneById.set(id, nextLane);
      nextLane++;
    }
  }

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
