/**
 * Converte Flow JSON da Meta (v4–v7) para telas/campos do CRM.
 * Suporta Form wrapper, múltiplas telas, Footer payload e componentes aninhados (If, etc.).
 */

import type { CrmFlowScreenInput } from "@/lib/meta-whatsapp/build-static-wa-flow-json";

const INPUT_COMPONENT_TYPES = new Set([
  "TextInput",
  "TextArea",
  "Dropdown",
  "RadioButtonsGroup",
  "CheckboxGroup",
  "DatePicker",
  "OptIn",
  "ChipsSelector",
]);

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseDataSourceOptions(component: Record<string, unknown>): string[] {
  const ds = arr(component["data-source"]);
  const out: string[] = [];
  for (const raw of ds) {
    const row = obj(raw);
    const title = str(row.title) || str(row.id);
    if (title) out.push(title);
  }
  return out;
}

function mapInputTypeFromMeta(componentType: string, inputType: string): string {
  const t = inputType.toLowerCase();
  if (t === "email") return "EMAIL";
  if (t === "phone") return "PHONE";
  if (componentType === "TextArea" || t === "textarea") return "TEXTAREA";
  if (componentType === "DatePicker") return "DATE";
  if (componentType === "Dropdown") return "DROPDOWN";
  if (componentType === "RadioButtonsGroup") return "RADIO";
  if (componentType === "CheckboxGroup" || componentType === "ChipsSelector") return "MULTI_SELECT";
  return "TEXT";
}

function extractFieldKeyFromPayloadValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/\$\{form\.([a-zA-Z0-9_]+)\}/);
  return m?.[1] ?? null;
}

type ParsedField = {
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: string[];
};

function collectFieldsFromPayload(payload: Record<string, unknown>): ParsedField[] {
  const out: ParsedField[] = [];
  for (const [key, val] of Object.entries(payload)) {
    if (key === "flow_token" || key.startsWith("__")) continue;
    const fromForm = extractFieldKeyFromPayloadValue(val);
    const fieldKey = (fromForm ?? key).replace(/[^a-zA-Z0-9_]/g, "_");
    if (!fieldKey) continue;
    out.push({
      fieldKey,
      label: fieldKey.replace(/_/g, " "),
      fieldType: "TEXT",
      required: false,
      options: [],
    });
  }
  return out;
}

function parseComponentToField(component: Record<string, unknown>): ParsedField | null {
  const type = str(component.type);
  if (!INPUT_COMPONENT_TYPES.has(type)) return null;

  const name = str(component.name);
  if (!name) return null;

  const fieldKey = name.replace(/[^a-zA-Z0-9_]/g, "_");
  const label =
    str(component.label) ||
    str(component.description) ||
    str(component["alt-text"]) ||
    fieldKey.replace(/_/g, " ");

  return {
    fieldKey,
    label: label.slice(0, 120),
    fieldType: mapInputTypeFromMeta(type, str(component["input-type"]) || type),
    required: Boolean(component.required),
    options: parseDataSourceOptions(component),
  };
}

/** Percorre árvore de componentes (Form, If, layout, etc.). */
function walkComponents(nodes: unknown[], acc: ParsedField[]): void {
  for (const raw of nodes) {
    const node = obj(raw);
    const type = str(node.type);

    if (type === "Form") {
      walkComponents(arr(node.children), acc);
      continue;
    }

    if (type === "If") {
      walkComponents(arr(node.then), acc);
      walkComponents(arr(node.else), acc);
      continue;
    }

    if (type === "Switch") {
      const cases = obj(node.cases);
      for (const caseChildren of Object.values(cases)) {
        walkComponents(arr(caseChildren), acc);
      }
      continue;
    }

    const field = parseComponentToField(node);
    if (field) {
      const exists = acc.some((f) => f.fieldKey === field.fieldKey);
      if (!exists) acc.push(field);
    }

    for (const key of ["children", "then", "else"]) {
      const nested = arr(node[key]);
      if (nested.length > 0) walkComponents(nested, acc);
    }
  }
}

function collectFooterPayloadFields(screen: Record<string, unknown>): ParsedField[] {
  const layout = obj(screen.layout);
  const children = arr(layout.children);
  const fromFooter: ParsedField[] = [];

  const scan = (nodes: unknown[]) => {
    for (const raw of nodes) {
      const node = obj(raw);
      if (str(node.type) === "Footer") {
        const action = obj(node["on-click-action"]);
        const payload = obj(action.payload);
        for (const f of collectFieldsFromPayload(payload)) {
          if (!fromFooter.some((x) => x.fieldKey === f.fieldKey)) fromFooter.push(f);
        }
      }
      walkComponents(arr(node.children), []);
      for (const nested of [arr(node.children), arr(obj(node).then), arr(obj(node).else)]) {
        if (nested.length) scan(nested);
      }
    }
  };

  scan(children);
  return fromFooter;
}

function mergeFieldLabels(primary: ParsedField[], footerHints: ParsedField[]): ParsedField[] {
  const labelByKey = new Map(footerHints.map((f) => [f.fieldKey, f.label]));
  return primary.map((f) => ({
    ...f,
    label: f.label !== f.fieldKey.replace(/_/g, " ") ? f.label : labelByKey.get(f.fieldKey) ?? f.label,
  }));
}

/**
 * Extrai telas e campos a partir do JSON exportado pela Meta.
 */
export function parseWaFlowJsonToCrmScreens(
  flowJson: Record<string, unknown>,
): CrmFlowScreenInput[] {
  const metaScreens = arr(flowJson.screens);
  const result: CrmFlowScreenInput[] = [];

  for (const rawScreen of metaScreens) {
    const sc = obj(rawScreen);
    const layout = obj(sc.layout);
    const children = arr(layout.children);

    const screenTitle = str(sc.title) || str(sc.id) || "Formulário";
    const fields: ParsedField[] = [];

    walkComponents(children, fields);

    const footerFields = collectFooterPayloadFields(sc);
    for (const ff of footerFields) {
      if (!fields.some((f) => f.fieldKey === ff.fieldKey)) {
        fields.push(ff);
      }
    }

    if (fields.length === 0 && footerFields.length > 0) {
      fields.push(...footerFields);
    }

    if (fields.length === 0) continue;

    const merged = mergeFieldLabels(fields, footerFields);

    result.push({
      title: screenTitle.slice(0, 80),
      fields: merged.map((f) => ({
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        options: f.options,
      })),
    });
  }

  if (result.length > 0) {
    return result;
  }

  // Fallback: extrair só dos payloads de Footer em todas as telas
  const allFooter: ParsedField[] = [];
  for (const rawScreen of metaScreens) {
    const sc = obj(rawScreen);
    for (const f of collectFooterPayloadFields(sc)) {
      if (!allFooter.some((x) => x.fieldKey === f.fieldKey)) allFooter.push(f);
    }
  }

  if (allFooter.length > 0) {
    return [
      {
        title: "Formulário",
        fields: allFooter.map((f) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          options: f.options,
        })),
      },
    ];
  }

  return [
    {
      title: "Formulário",
      fields: [
        {
          fieldKey: "resposta",
          label: "Resposta (reimporte da Meta ou edite o JSON)",
          fieldType: "TEXT",
          required: false,
          options: [],
        },
      ],
    },
  ];
}
