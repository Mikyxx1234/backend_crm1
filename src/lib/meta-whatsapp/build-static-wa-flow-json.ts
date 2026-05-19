/**
 * Gera o JSON estático de um WhatsApp Flow (Flow JSON v5) a partir do modelo
 * normalizado no CRM (telas + campos). Um único ecrã Meta com secções por tela.
 *
 * @see https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson/
 */

export type CrmFlowFieldInput = {
  fieldKey: string;
  label: string;
  /** TEXT | EMAIL | PHONE | TEXTAREA | DROPDOWN | RADIO | MULTI_SELECT | DATE */
  fieldType: string;
  required: boolean;
  options?: string[];
};

export type CrmFlowScreenInput = {
  title: string;
  fields: CrmFlowFieldInput[];
};

function mapInputType(fieldType: string): "text" | "email" | "phone" {
  const t = fieldType.toUpperCase();
  if (t === "EMAIL") return "email";
  if (t === "PHONE") return "phone";
  return "text";
}

function slugOptionId(title: string, index: number): string {
  const s = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (s || `opt_${index + 1}`).slice(0, 40);
}

function buildDataSource(options?: string[]): { id: string; title: string }[] {
  const opts = (options ?? []).map((o) => o.trim()).filter(Boolean);
  if (opts.length === 0) {
    return [
      { id: "opcao_1", title: "Opção 1" },
      { id: "opcao_2", title: "Opção 2" },
    ];
  }
  return opts.map((title, i) => ({
    id: slugOptionId(title, i),
    title: title.slice(0, 80),
  }));
}

function buildFieldComponent(f: CrmFlowFieldInput): Record<string, unknown> {
  const key = f.fieldKey.trim().replace(/[^a-zA-Z0-9_]/g, "_") || "campo";
  const label = f.label.trim().slice(0, 80) || key;
  const t = f.fieldType.toUpperCase();

  if (t === "TEXTAREA") {
    return { type: "TextArea", name: key, label, required: f.required };
  }
  if (t === "DROPDOWN" || t === "SELECT") {
    return {
      type: "Dropdown",
      name: key,
      label,
      required: f.required,
      "data-source": buildDataSource(f.options),
    };
  }
  if (t === "RADIO") {
    return {
      type: "RadioButtonsGroup",
      name: key,
      label,
      required: f.required,
      "data-source": buildDataSource(f.options),
    };
  }
  if (t === "MULTI_SELECT" || t === "CHECKBOX") {
    return {
      type: "CheckboxGroup",
      name: key,
      label,
      required: f.required,
      "data-source": buildDataSource(f.options),
    };
  }
  if (t === "DATE") {
    return { type: "DatePicker", name: key, label, required: f.required };
  }

  return {
    type: "TextInput",
    name: key,
    label,
    "input-type": mapInputType(f.fieldType),
    required: f.required,
  };
}

/**
 * Devolve o objeto Flow JSON (não stringificado) para inspeção/testes.
 */
export function buildWaFlowJsonObject(input: { screens: CrmFlowScreenInput[] }): Record<string, unknown> {
  let screens = input.screens.filter((s) => s.title.trim() || s.fields.length > 0);
  if (screens.length === 0) {
    screens = [
      {
        title: "Formulário",
        fields: [{ fieldKey: "nome", label: "Nome", fieldType: "TEXT", required: true }],
      },
    ];
  }

  const children: Record<string, unknown>[] = [];
  for (const screen of screens) {
    if (screen.title.trim()) {
      children.push({ type: "TextHeading", text: screen.title.trim().slice(0, 80) });
    }
    for (const f of screen.fields) {
      children.push(buildFieldComponent(f));
    }
  }

  const payload: Record<string, string> = {};
  for (const screen of screens) {
    for (const f of screen.fields) {
      const key = f.fieldKey.trim().replace(/[^a-zA-Z0-9_]/g, "_") || "campo";
      payload[key] = `\${form.${key}}`;
    }
  }

  children.push({
    type: "Footer",
    label: "Concluir",
    "on-click-action": {
      name: "complete",
      payload,
    },
  });

  const mainTitle = screens[0]?.title?.trim()?.slice(0, 60) || "Formulário";

  return {
    version: "5.0",
    screens: [
      {
        id: "MAIN",
        title: mainTitle,
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children,
        },
        terminal: true,
        success: true,
      },
    ],
  };
}

/** String JSON a enviar em `flow_json` na API POST /{WABA-ID}/flows */
export function buildWaFlowJsonString(input: { screens: CrmFlowScreenInput[] }): string {
  return JSON.stringify(buildWaFlowJsonObject(input));
}
