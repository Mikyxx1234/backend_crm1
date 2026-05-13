/**
 * Aplica um `CopilotPatch` em um array de steps.
 *
 * Função pura, sem React. Usada pela UI depois que o operador
 * aprova um patch proposto pelo copilot.
 *
 * Suporta 4 ops: add_step, update_step_config, remove_step, connect.
 */

import type { CopilotPatch, CopilotPatchOp } from "@/services/ai/automation-copilot";

import {
  newStepId,
  type AutomationStep,
} from "@/lib/automation-workflow";
import {
  normalizeConditionConfig,
  type ConditionConfig,
} from "@/lib/automation-condition";

const NONE_ID = "__none__";

type Handle =
  | "next"
  | "received"
  | "timeout"
  | "else"
  | `branch:${string}`
  | `button:${number}`;

function setHandleTarget(
  step: AutomationStep,
  handle: string,
  targetStepId: string,
): void {
  const cfg = step.config;
  if (handle === "next") {
    cfg.nextStepId = targetStepId;
    return;
  }
  if (handle === "received") {
    cfg.receivedGotoStepId = targetStepId;
    return;
  }
  if (handle === "timeout") {
    cfg.timeoutGotoStepId = targetStepId;
    return;
  }
  if (handle === "else") {
    // business_hours usa elseStepId; demais usam elseGotoStepId
    if (step.type === "business_hours") {
      cfg.elseStepId = targetStepId;
    } else if (step.type === "condition") {
      const cond = normalizeConditionConfig(step.config);
      cond.elseStepId = targetStepId;
      step.config = cond as unknown as Record<string, unknown>;
    } else {
      cfg.elseGotoStepId = targetStepId;
    }
    return;
  }
  if (handle.startsWith("branch:")) {
    const branchId = handle.slice("branch:".length);
    if (step.type === "condition") {
      const cond: ConditionConfig = normalizeConditionConfig(step.config);
      const b = cond.branches.find((br) => br.id === branchId);
      if (b) {
        b.nextStepId = targetStepId;
        step.config = cond as unknown as Record<string, unknown>;
      }
    }
    return;
  }
  if (handle.startsWith("button:")) {
    const idx = Number(handle.slice("button:".length));
    if (!Number.isFinite(idx)) return;
    const buttons = Array.isArray(cfg.buttons)
      ? (cfg.buttons as Record<string, unknown>[]).map((b) => ({ ...b }))
      : [];
    if (buttons[idx]) {
      buttons[idx].gotoStepId = targetStepId;
      cfg.buttons = buttons;
    }
    return;
  }
}

function cloneStep(step: AutomationStep): AutomationStep {
  return {
    id: step.id,
    type: step.type,
    config: JSON.parse(JSON.stringify(step.config ?? {})) as Record<string, unknown>,
  };
}

export function applyCopilotPatch(
  steps: AutomationStep[],
  patch: CopilotPatch,
): AutomationStep[] {
  const out: AutomationStep[] = steps.map(cloneStep);
  const byId = new Map(out.map((s) => [s.id, s]));

  for (const op of patch.ops as CopilotPatchOp[]) {
    if (op.op === "add_step") {
      const id = op.step.id && !byId.has(op.step.id) ? op.step.id : newStepId();
      const config: Record<string, unknown> = {
        ...(op.step.config ?? {}),
        __hasExplicitEdges: true,
      };
      // Default de fim-de-ramo pra evitar fallback linear (mesma lógica
      // do workflow-canvas quando o usuário adiciona step manualmente).
      if (op.step.type !== "condition" && !("nextStepId" in config)) {
        config.nextStepId = NONE_ID;
      }
      const newStep: AutomationStep = { id, type: op.step.type, config };
      out.push(newStep);
      byId.set(id, newStep);

      if (op.after) {
        const src = byId.get(op.after);
        if (src) {
          const handle = (op.afterHandle ?? "next") as Handle;
          setHandleTarget(src, handle, id);
        }
      }
      continue;
    }

    if (op.op === "update_step_config") {
      const target = byId.get(op.stepId);
      if (!target) continue;
      if (op.merge === false) {
        target.config = { ...op.config, __hasExplicitEdges: target.config.__hasExplicitEdges };
      } else {
        target.config = { ...target.config, ...op.config };
      }
      continue;
    }

    if (op.op === "remove_step") {
      const idx = out.findIndex((s) => s.id === op.stepId);
      if (idx < 0) continue;
      out.splice(idx, 1);
      byId.delete(op.stepId);
      // Limpa todas as referências ao step removido.
      for (const s of out) {
        const cfg = s.config;
        if (cfg.nextStepId === op.stepId) cfg.nextStepId = "";
        if (cfg.receivedGotoStepId === op.stepId) cfg.receivedGotoStepId = "";
        if (cfg.timeoutGotoStepId === op.stepId) cfg.timeoutGotoStepId = "";
        if (cfg.elseGotoStepId === op.stepId) cfg.elseGotoStepId = "";
        if (cfg.elseStepId === op.stepId) cfg.elseStepId = "";
        if (cfg.targetStepId === op.stepId) cfg.targetStepId = "";
        if (Array.isArray(cfg.buttons)) {
          cfg.buttons = (cfg.buttons as Record<string, unknown>[]).map((b) =>
            b.gotoStepId === op.stepId ? { ...b, gotoStepId: "" } : b,
          );
        }
        if (s.type === "condition") {
          const cond = normalizeConditionConfig(s.config);
          let changed = false;
          for (const b of cond.branches) {
            if (b.nextStepId === op.stepId) {
              b.nextStepId = "";
              changed = true;
            }
          }
          if (cond.elseStepId === op.stepId) {
            cond.elseStepId = "";
            changed = true;
          }
          if (changed) s.config = cond as unknown as Record<string, unknown>;
        }
      }
      continue;
    }

    if (op.op === "connect") {
      const src = byId.get(op.fromStepId);
      if (!src) continue;
      if (!byId.has(op.toStepId)) continue;
      setHandleTarget(src, op.handle, op.toStepId);
      src.config.__hasExplicitEdges = true;
      continue;
    }
  }

  return out;
}
