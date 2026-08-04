/**
 * Converte variáveis de template em formato "amigável" (`[{ component, key,
 * value }]`) para o array `components` que a Cloud API espera.
 *
 * Existe para que integrações (node do n8n, automações) informem apenas
 * `{{1}} = "João"` e não precisem montar à mão o JSON aninhado da Meta —
 * que é a principal fonte de erro 132000/132012 em envio de template.
 *
 * Posicional vs. nomeado: a Meta aceita os dois formatos, mas nunca
 * misturados no mesmo template. Se TODAS as chaves de um componente forem
 * numéricas, emitimos parâmetros posicionais ordenados por número; caso
 * contrário emitimos `parameter_name` (templates com `parameter_format:
 * NAMED`). Misturar geraria erro na Graph, então a decisão é por componente
 * e determinística.
 */

import { extractPlaceholderKeysFromBodyText } from "./operator-template-variables";

export type TemplateVariableComponent = "body" | "header" | "button";

export type TemplateVariableInput = {
  /** Componente alvo. Ausente = `body` (caso dominante). */
  component?: TemplateVariableComponent;
  /** `1`, `2`… (posicional) ou o nome do placeholder (`nome`, `curso`). */
  key: string;
  value: string;
  /** Índice do botão na ordem do template. Só para `component: "button"`. */
  buttonIndex?: number;
};

type MetaParameter = Record<string, unknown>;

function isPositional(keys: string[]): boolean {
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

function buildParameters(vars: TemplateVariableInput[]): MetaParameter[] {
  const keys = vars.map((v) => v.key);
  if (isPositional(keys)) {
    return [...vars]
      .sort((a, b) => Number(a.key) - Number(b.key))
      .map((v) => ({ type: "text", text: v.value }));
  }
  return vars.map((v) => ({
    type: "text",
    parameter_name: v.key,
    text: v.value,
  }));
}

/**
 * @param vars Variáveis preenchidas pelo operador. Entradas sem `key` ou com
 *   `value` nulo são descartadas — `value` vazio é preservado, pois a Meta
 *   rejeita parâmetro faltando mas aceita string vazia.
 * @returns Array pronto para `POST /messages { template: { components } }`.
 *   Vazio quando não há nenhuma variável (template sem placeholders).
 */
export function buildTemplateComponents(
  vars: TemplateVariableInput[] | null | undefined,
): unknown[] {
  if (!Array.isArray(vars) || vars.length === 0) return [];

  const clean = vars
    .map((v) => ({
      component: (v.component ?? "body") as TemplateVariableComponent,
      key: String(v.key ?? "").trim(),
      value: v.value == null ? "" : String(v.value),
      buttonIndex: typeof v.buttonIndex === "number" ? v.buttonIndex : 0,
    }))
    .filter((v) => v.key.length > 0);

  if (clean.length === 0) return [];

  const components: unknown[] = [];

  const header = clean.filter((v) => v.component === "header");
  if (header.length > 0) {
    components.push({ type: "header", parameters: buildParameters(header) });
  }

  const body = clean.filter((v) => v.component === "body");
  if (body.length > 0) {
    components.push({ type: "body", parameters: buildParameters(body) });
  }

  // Botões dinâmicos (URL com sufixo variável) exigem um componente por
  // botão, com o índice na ordem em que aparece no template.
  const buttons = clean.filter((v) => v.component === "button");
  if (buttons.length > 0) {
    const byIndex = new Map<number, TemplateVariableInput[]>();
    for (const v of buttons) {
      const idx = v.buttonIndex ?? 0;
      const list = byIndex.get(idx) ?? [];
      list.push(v);
      byIndex.set(idx, list);
    }
    for (const idx of [...byIndex.keys()].sort((a, b) => a - b)) {
      components.push({
        type: "button",
        sub_type: "url",
        index: String(idx),
        parameters: (byIndex.get(idx) ?? []).map((v) => ({
          type: "text",
          text: v.value,
        })),
      });
    }
  }

  return components;
}

/**
 * Renderiza o texto do template substituindo os placeholders pelos valores
 * informados. Usado no preview retornado pela API — o que o node mostra ao
 * operador é exatamente o que a Meta vai renderizar.
 *
 * Placeholders sem valor correspondente ficam intactos (`{{2}}`), sinalizando
 * visualmente o que falta preencher.
 */
export function renderTemplatePreview(
  text: string | null | undefined,
  vars: TemplateVariableInput[] | null | undefined,
): string {
  if (!text) return "";
  const byKey = new Map(
    (vars ?? [])
      .filter((v) => v && String(v.key ?? "").trim())
      .map((v) => [String(v.key).trim(), v.value == null ? "" : String(v.value)]),
  );
  return text.replace(/\{\{([^}]+)\}\}/g, (match, raw: string) => {
    const key = raw.trim();
    return byKey.has(key) ? (byKey.get(key) as string) : match;
  });
}

/** Reexport para consumidores que só precisam saber quais chaves existem. */
export { extractPlaceholderKeysFromBodyText };
