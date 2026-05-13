type KommoGoto = { params: { step: number; type: string }; handler: string };
type KommoAction = { params: Record<string, unknown>; handler: string };
type KommoButtonOption = {
  value?: string;
  type?: string;
  params: KommoAction[];
  synonyms?: string[];
};
type KommoStep = {
  question?: KommoAction[];
  answer?: { params: KommoButtonOption[]; handler: string }[];
  no_answer?: KommoGoto;
  finish?: KommoAction[];
  block_uuid: string;
};

export type ParsedCrmStep = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

export type ParsedAutomation = {
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  steps: ParsedCrmStep[];
};

function mapVariables(text: string): string {
  return text
    .replace(/\{\{lead\.cf\.(\d+)\.(\d+)\}\}/g, "{{cf_$1_$2}}")
    .replace(/\{\{lead\.cf\.(\d+)\}\}/g, "{{cf_$1}}")
    .replace(/\{\{message_text\}\}/g, "{{lastResponse}}");
}

function mapOp(op: string): string {
  const m: Record<string, string> = { "=": "eq", "!=": "ne", ">": "gt", "<": "lt", contains: "includes" };
  return m[op] ?? "eq";
}

function extractGotoStepId(action: KommoGoto | KommoAction | undefined, resolve: (n: number) => string): string {
  if (!action) return "";
  const p = action.params as Record<string, unknown>;
  if (action.handler === "goto" && typeof p.step === "number") return resolve(p.step);
  return "";
}

export function parseKommoBot(json: Record<string, unknown>): ParsedAutomation {
  const model = json.model as Record<string, unknown>;
  const raw: Record<string, KommoStep> =
    typeof model.text === "string" ? JSON.parse(model.text) : (model.text as Record<string, KommoStep>);
  const posRaw: { x: number; y: number; block_uuid?: string }[] =
    typeof model.positions === "string" ? JSON.parse(model.positions) : ((model.positions ?? []) as { x: number; y: number; block_uuid?: string }[]);

  const posMap = new Map<string, { x: number; y: number }>();
  for (const p of posRaw) {
    if (p.block_uuid) posMap.set(p.block_uuid, { x: p.x, y: p.y });
  }

  const stepKeys = Object.keys(raw).filter((k) => k !== "conversation" && raw[k]?.block_uuid);

  const idMap = new Map<number, string>();
  for (const k of stepKeys) idMap.set(Number(k), `step_k${k}`);
  const resolve = (n: number) => idMap.get(n) ?? `step_k${n}`;

  let minX = Infinity;
  let minY = Infinity;
  for (const k of stepKeys) {
    const pos = posMap.get(raw[k].block_uuid);
    if (pos) {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
    }
  }
  if (!isFinite(minX)) minX = 0;
  if (!isFinite(minY)) minY = 0;
  const offsetX = 200 - minX;
  const offsetY = 150 - minY;

  function rfPos(uuid: string): Record<string, unknown> {
    const p = posMap.get(uuid);
    if (!p) return {};
    return { __rfPos: { x: p.x + offsetX, y: p.y + offsetY } };
  }

  const steps: ParsedCrmStep[] = [];

  for (const key of stepKeys) {
    const kStep = raw[key];
    const sid = resolve(Number(key));
    const rp = rfPos(kStep.block_uuid);

    if (kStep.finish) {
      steps.push({ id: sid, type: "finish", config: { action: "stop", ...rp } });
      continue;
    }

    const qArr = kStep.question;
    if (!qArr || qArr.length === 0) continue;

    const first = qArr[0];
    const gotoEntry = qArr.find((q) => q.handler === "goto");
    const nextId = gotoEntry ? extractGotoStepId(gotoEntry as KommoGoto, resolve) : "";

    switch (first.handler) {
      case "send_message": {
        const p = first.params as Record<string, unknown>;
        const text = mapVariables(String(p.text ?? ""));

        if (kStep.answer && kStep.answer.length > 0 && kStep.answer[0].handler === "buttons") {
          const btns: { text: string; gotoStepId: string }[] = [];
          let elseGoto = "";

          for (const opt of kStep.answer[0].params as KommoButtonOption[]) {
            if (opt.type === "else") {
              const g = opt.params?.[0];
              elseGoto = g ? extractGotoStepId(g as KommoGoto, resolve) : "";
            } else {
              const g = opt.params?.[0];
              btns.push({
                text: String(opt.value ?? ""),
                gotoStepId: g ? extractGotoStepId(g as KommoGoto, resolve) : "",
              });
            }
          }

          const noAnswerGoto = kStep.no_answer ? extractGotoStepId(kStep.no_answer, resolve) : "";

          steps.push({
            id: sid,
            type: "question",
            config: {
              message: text,
              buttons: btns,
              saveToVariable: "lastResponse",
              timeoutMs: 86_400_000,
              timeoutAction: noAnswerGoto ? "goto" : "continue",
              timeoutGotoStepId: noAnswerGoto,
              elseGotoStepId: elseGoto,
              ...rp,
            },
          });
        } else {
          steps.push({
            id: sid,
            type: "send_whatsapp_message",
            config: { content: text, _nextStepId: nextId, ...rp },
          });
        }
        break;
      }

      case "conditions": {
        const allConds = qArr.filter((q) => q.handler === "conditions");
        const firstCond = allConds[0];
        const cp = firstCond.params as Record<string, unknown>;
        const conditions = (cp.conditions ?? []) as { term1: string; term2: string; operation: string }[];
        const result = (cp.result ?? []) as KommoAction[];
        const c0 = conditions[0];

        const trueGoto = result[0] ? extractGotoStepId(result[0] as KommoGoto, resolve) : "";

        steps.push({
          id: sid,
          type: "condition",
          config: {
            path: c0 ? mapVariables(c0.term1) : "",
            op: c0 ? mapOp(c0.operation) : "eq",
            value: c0 ? mapVariables(c0.term2) : "",
            _trueGotoStepId: trueGoto,
            _falseGotoStepId: nextId,
            _branches: allConds.map((ac) => {
              const acp = ac.params as Record<string, unknown>;
              const aConds = (acp.conditions ?? []) as { term1: string; term2: string; operation: string }[];
              const aResult = (acp.result ?? []) as KommoAction[];
              return {
                conditions: aConds.map((cc) => ({
                  field: mapVariables(cc.term1),
                  op: mapOp(cc.operation),
                  value: mapVariables(cc.term2),
                })),
                gotoStepId: aResult[0] ? extractGotoStepId(aResult[0] as KommoGoto, resolve) : "",
              };
            }),
            ...rp,
          },
        });
        break;
      }

      case "waits": {
        const wp = first.params as Record<string, unknown>;
        const conds = (wp.conditions ?? []) as {
          event: { source: string; delay?: number; action: string };
          action: { step: number; type: string };
        }[];
        const msgEvt = conds.find((c) => c.event.source === "message");
        const timerEvt = conds.find((c) => c.event.source === "timer");

        if (msgEvt) {
          const answeredGoto = resolve(msgEvt.action.step);
          const timeoutGoto = timerEvt ? resolve(timerEvt.action.step) : "";
          const delayMs = (timerEvt?.event.delay ?? 900) * 1000;

          steps.push({
            id: sid,
            type: "question",
            config: {
              message: "",
              buttons: [],
              saveToVariable: "lastResponse",
              timeoutMs: delayMs,
              timeoutAction: timeoutGoto ? "goto" : "continue",
              timeoutGotoStepId: timeoutGoto,
              elseGotoStepId: answeredGoto,
              _answeredGotoStepId: answeredGoto,
              ...rp,
            },
          });
        } else if (timerEvt) {
          const delayMs = (timerEvt.event.delay ?? 60) * 1000;
          const timerGoto = resolve(timerEvt.action.step);
          steps.push({
            id: sid,
            type: "delay",
            config: { ms: delayMs, _nextStepId: timerGoto, ...rp },
          });
        }
        break;
      }

      case "action": {
        const ap = first.params as Record<string, unknown>;
        const actName = String(ap.name ?? "");
        const actParams = (ap.params ?? {}) as Record<string, unknown>;

        if (actName === "set_custom_fields") {
          steps.push({
            id: sid,
            type: "set_variable",
            config: {
              variableName: mapVariables(String(actParams.custom_field ?? "")),
              value: mapVariables(String(actParams.value ?? "")),
              _nextStepId: nextId,
              ...rp,
            },
          });
        } else if (actName === "change_status") {
          steps.push({
            id: sid,
            type: "move_stage",
            config: {
              stageId: String(actParams.value ?? ""),
              _pipelineId: String(actParams.pipeline_id ?? ""),
              _nextStepId: nextId,
              ...rp,
            },
          });
        } else if (actName === "set_tag") {
          const tags = Array.isArray(actParams.value) ? actParams.value : [actParams.value];
          steps.push({
            id: sid,
            type: "add_tag",
            config: { tagName: tags.join(", "), _nextStepId: nextId, ...rp },
          });
        } else {
          steps.push({
            id: sid,
            type: "set_variable",
            config: {
              variableName: `_kommo_${actName}`,
              value: JSON.stringify(actParams),
              _nextStepId: nextId,
              ...rp,
            },
          });
        }
        break;
      }

      case "trigger": {
        const tp = first.params as Record<string, unknown>;
        const trigger = (tp.trigger ?? {}) as Record<string, unknown>;
        const settings = (trigger.settings ?? {}) as Record<string, unknown>;
        steps.push({
          id: sid,
          type: "webhook",
          config: { url: String(settings.url ?? ""), method: "POST", _nextStepId: nextId, ...rp },
        });
        break;
      }

      case "start": {
        const sp = first.params as Record<string, unknown>;
        steps.push({
          id: sid,
          type: "send_whatsapp_message",
          config: {
            content: `[Bot externo #${sp.bot ?? "?"}]`,
            _nextStepId: nextId,
            ...rp,
          },
        });
        break;
      }

      default: {
        steps.push({
          id: sid,
          type: "send_whatsapp_message",
          config: { content: `[Kommo: ${first.handler}]`, _nextStepId: nextId, ...rp },
        });
      }
    }
  }

  return {
    name: String(model.name ?? "Bot Importado"),
    triggerType: "message_received",
    triggerConfig: { channel: "" },
    steps,
  };
}
