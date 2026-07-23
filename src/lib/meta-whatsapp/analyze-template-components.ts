import { isFlowDefinitionButton } from "@/lib/meta-whatsapp/is-flow-definition-button";

export type TemplateButton = {
  /** QUICK_REPLY | URL | PHONE_NUMBER | FLOW | COPY_CODE ... */
  type: string;
  /** Rótulo visível do botão (ex.: "Quero"). */
  text: string;
  /** URL (só para botões URL). */
  url: string | null;
};

export type TemplateComponentsAnalysis = {
  hasButtons: boolean;
  /** Tipos distintos de botão (ex.: FLOW, URL, QUICK_REPLY), ordenados. */
  buttonTypes: string[];
  /** Botões na ordem em que aparecem no template, com rótulo. */
  buttons: TemplateButton[];
  /** Texto do componente BODY (para preview). */
  bodyText: string | null;
  hasVariables: boolean;
  flowAction: string | null;
  flowId: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Detecta placeholders `{{1}}`, `{{nome}}`, etc. */
function textHasVariablePlaceholders(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text);
}

/**
 * Analisa o array `components` retornado pela Graph API (`message_templates`)
 * e metadados opcionais do template (ex.: `parameter_format` no nível raiz).
 */
export function analyzeTemplateComponents(
  components: unknown[] | null | undefined,
  options?: { parameterFormat?: string | null },
): TemplateComponentsAnalysis {
  const buttonTypesSet = new Set<string>();
  const buttons: TemplateButton[] = [];
  let bodyText: string | null = null;
  let hasVariables = false;
  let flowAction: string | null = null;
  let flowId: string | null = null;

  if (options?.parameterFormat?.trim().toUpperCase() === "NAMED") {
    hasVariables = true;
  }

  if (!Array.isArray(components)) {
    return {
      hasButtons: false,
      buttonTypes: [],
      buttons: [],
      bodyText: null,
      hasVariables,
      flowAction: null,
      flowId: null,
    };
  }

  for (const c of components) {
    const comp = asRecord(c);
    if (!comp) continue;
    const type = String(comp.type ?? "").toUpperCase();

    if (type === "BODY" || type === "HEADER") {
      const text = typeof comp.text === "string" ? comp.text : "";
      if (type === "BODY" && text) bodyText = text;
      if (textHasVariablePlaceholders(text)) hasVariables = true;
      const pf = String(comp.parameter_format ?? comp.parameterFormat ?? "").toUpperCase();
      if (pf === "NAMED") hasVariables = true;
    }

    if (type === "BUTTONS" && Array.isArray(comp.buttons)) {
      for (const b of comp.buttons) {
        const btn = asRecord(b);
        if (!btn) continue;
        const rawType = String(btn.type ?? "").toUpperCase();
        const label = typeof btn.text === "string" ? btn.text : "";
        const url = typeof btn.url === "string" ? btn.url : null;
        if (isFlowDefinitionButton(btn)) {
          buttonTypesSet.add("FLOW");
          buttons.push({ type: "FLOW", text: label, url: null });
          if (flowAction == null) {
            const fa = btn.flow_action ?? btn.flowAction;
            if (typeof fa === "string" && fa.trim()) flowAction = fa.trim();
          }
          if (flowId == null) {
            const fid = btn.flow_id ?? btn.flowId;
            if (fid != null && String(fid).trim()) flowId = String(fid);
          }
        } else if (rawType) {
          buttonTypesSet.add(rawType);
          buttons.push({ type: rawType, text: label, url });
        }
      }
    }
  }

  const buttonTypes = Array.from(buttonTypesSet).sort();
  return {
    hasButtons: buttonTypes.length > 0,
    buttonTypes,
    buttons,
    bodyText,
    hasVariables,
    flowAction,
    flowId,
  };
}
