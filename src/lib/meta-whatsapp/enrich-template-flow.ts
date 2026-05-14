import { randomUUID } from "node:crypto";

import type { MetaWhatsAppClient } from "@/lib/meta-whatsapp/client";
import { MetaFlowEnrichError } from "@/lib/meta-whatsapp/meta-flow-enrich-error";
import { isFlowDefinitionButton } from "@/lib/meta-whatsapp/is-flow-definition-button";

export { isFlowDefinitionButton };

/**
 * Templates com botão FLOW exigem componente `button` + `sub_type: "flow"`
 * no envio, mesmo sem variáveis no corpo/cabeçalho — caso contrário a Meta
 * pode entregar só parte da mensagem (ex.: só o body).
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 * @see https://developers.facebook.com/docs/whatsapp/flows
 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Índice 0-based do botão FLOW na definição do template (Graph `message_templates`). */
export function getFlowButtonIndexFromTemplateDefinition(
  components: unknown,
): string | null {
  if (!Array.isArray(components)) return null;
  let idx = 0;
  for (const c of components) {
    const o = asRecord(c);
    if (!o || String(o.type ?? "").toUpperCase() !== "BUTTONS") continue;
    const buttons = o.buttons;
    if (!Array.isArray(buttons)) continue;
    for (const b of buttons) {
      const btn = asRecord(b);
      if (!btn) continue;
      if (isFlowDefinitionButton(btn)) return String(idx);
      idx += 1;
    }
  }
  return null;
}

function sendPayloadAlreadyHasFlowButton(components: unknown[]): boolean {
  for (const c of components) {
    const o = asRecord(c);
    if (!o) continue;
    const type = String(o.type ?? "").toLowerCase();
    const sub = String(o.sub_type ?? (o as { subType?: string }).subType ?? "").toLowerCase();
    if (type === "button" && sub === "flow") return true;
  }
  return false;
}

/** Extrai `flow_token` do primeiro componente button/flow do payload de envio. */
export function extractFlowTokenFromSendComponents(components: unknown[]): string | null {
  for (const c of components) {
    const o = asRecord(c);
    if (!o) continue;
    const type = String(o.type ?? "").toLowerCase();
    const sub = String(o.sub_type ?? (o as { subType?: string }).subType ?? "").toLowerCase();
    if (type !== "button" || sub !== "flow") continue;
    const params = o.parameters;
    if (!Array.isArray(params) || params.length === 0) continue;
    const p0 = asRecord(params[0]);
    if (!p0 || String(p0.type ?? "").toLowerCase() !== "action") continue;
    const action = asRecord(p0.action);
    const tok = action?.flow_token;
    if (typeof tok === "string" && tok.trim().length > 0) return tok.trim();
  }
  return null;
}

type ListTemplatesRow = {
  name?: string;
  language?: string;
  components?: unknown;
};

function extractTemplatesData(raw: unknown): ListTemplatesRow[] {
  const o = asRecord(raw);
  const data = o?.data;
  return Array.isArray(data) ? (data as ListTemplatesRow[]) : [];
}

function extractPagingAfter(raw: unknown): string | undefined {
  const o = asRecord(raw);
  const paging = asRecord(o?.paging);
  const cursors = asRecord(paging?.cursors);
  const a = cursors?.after;
  return typeof a === "string" && a.length > 0 ? a : undefined;
}

function pickTemplateRow(
  rows: ListTemplatesRow[],
  templateName: string,
  languageCode: string,
): ListTemplatesRow | null {
  const lang = languageCode.trim();
  const name = templateName.trim();
  const exact = rows.find(
    (r) => String(r.name ?? "") === name && String(r.language ?? "").toLowerCase() === lang.toLowerCase(),
  );
  if (exact) return exact;
  return rows.find((r) => String(r.name ?? "") === name) ?? null;
}

/** Botões planos nas secções BUTTONS da definição Graph (só para logs de diagnóstico). */
function collectFlatButtonsFromDefinitionComponents(components: unknown): unknown[] {
  if (!Array.isArray(components)) return [];
  const out: unknown[] = [];
  for (const c of components) {
    const o = asRecord(c);
    if (!o || String(o.type ?? "").toUpperCase() !== "BUTTONS") continue;
    const buttons = o.buttons;
    if (!Array.isArray(buttons)) continue;
    for (const b of buttons) out.push(b);
  }
  return out;
}

type TemplateDefinitionResolution = {
  row: ListTemplatesRow | null;
  resolutionPath:
    | "getMessageTemplateByGraphId"
    | "getMessageTemplateByGraphId_empty"
    | "getMessageTemplateByGraphId_error"
    | "listMessageTemplates"
    | "listMessageTemplates_none";
};

/**
 * Resolve a linha do template (nome + idioma + components) via ID Graph
 * ou listagem paginada — evita falhar quando o template não está na primeira página.
 */
async function resolveTemplateDefinitionRow(
  client: MetaWhatsAppClient,
  args: {
    templateName: string;
    languageCode: string;
    templateGraphId?: string | null;
    strictFlowEnrich: boolean;
  },
): Promise<TemplateDefinitionResolution> {
  const gid = args.templateGraphId?.trim();
  if (gid) {
    try {
      const raw = await client.getMessageTemplateByGraphId(gid);
      const o = asRecord(raw);
      if (!o) {
        if (args.strictFlowEnrich) {
          throw new MetaFlowEnrichError(
            `[meta-flow-enrich] GET message_template retornou corpo vazio para templateGraphId=${gid}`,
          );
        }
        return { row: null, resolutionPath: "getMessageTemplateByGraphId_empty" };
      }
      return {
        row: {
          name: typeof o.name === "string" ? o.name : args.templateName,
          language: typeof o.language === "string" ? o.language : args.languageCode,
          components: o.components,
        },
        resolutionPath: "getMessageTemplateByGraphId",
      };
    } catch (e) {
      if (args.strictFlowEnrich) {
        if (e instanceof MetaFlowEnrichError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        throw new MetaFlowEnrichError(
          `[meta-flow-enrich] Falha ao obter template por ID Graph ${gid}: ${msg}`,
        );
      }
      return { row: null, resolutionPath: "getMessageTemplateByGraphId_error" };
    }
  }

  let after: string | undefined;
  for (let page = 0; page < 40; page++) {
    let listRaw: unknown;
    try {
      listRaw = await client.listMessageTemplates({ limit: 500, after });
    } catch {
      listRaw = null;
    }
    const rows = extractTemplatesData(listRaw);
    const row = pickTemplateRow(rows, args.templateName, args.languageCode);
    if (row) return { row, resolutionPath: "listMessageTemplates" };
    after = extractPagingAfter(listRaw);
    if (!after) break;
  }
  return { row: null, resolutionPath: "listMessageTemplates_none" };
}

export function buildFlowButtonComponent(
  index: string,
  flowToken: string,
  flowActionData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const token = flowToken.trim();
  if (!token) {
    throw new MetaFlowEnrichError(
      "[meta-flow-enrich] flow_token vazio — use UUID por envio ou valor explícito.",
    );
  }
  const mergedActionData: Record<string, unknown> = {
    ...(flowActionData && typeof flowActionData === "object" && !Array.isArray(flowActionData)
      ? flowActionData
      : {}),
  };
  return {
    type: "button",
    sub_type: "flow",
    index,
    parameters: [
      {
        type: "action",
        action: {
          flow_token: token,
          flow_action_data: mergedActionData,
        },
      },
    ],
  };
}

export type EnrichTemplateFlowSendResult = {
  components: unknown[] | undefined;
  /** Token usado no componente Flow (UUID ou valor explícito). `null` se o template não tem botão Flow. */
  flowToken: string | null;
};

/**
 * Consulta a definição do template na Meta (por ID Graph ou listagem paginada),
 * localiza botão FLOW e acrescenta o componente exigido pela Cloud API.
 */
export async function enrichTemplateComponentsForFlowSend(
  client: MetaWhatsAppClient,
  args: {
    templateName: string;
    languageCode: string;
    components?: unknown[] | undefined;
    /** ID Graph do template (`meta_template_id` salvo em config / picker do inbox). */
    templateGraphId?: string | null;
    /** Token de correlação / sessão Flow; se omitido e o template tiver Flow, gera-se UUID v4. */
    flowToken?: string | null;
    /** Dados iniciais do fluxo; sempre fundidos em `flow_action_data` (objeto, possivelmente vazio). */
    flowActionData?: Record<string, unknown> | null;
    /**
     * Se true (default): falha se o template na Graph tiver botão Flow e o payload final
     * não incluir `button`/`sub_type: flow`; e se `templateGraphId` estiver definido,
     * falha ao não conseguir obter a definição por ID.
     */
    strictFlowEnrich?: boolean;
  },
): Promise<EnrichTemplateFlowSendResult> {
  const strictFlowEnrich = args.strictFlowEnrich !== false;
  const base =
    Array.isArray(args.components) && args.components.length > 0
      ? [...args.components]
      : [];

  console.log(
    "[meta-flow-enrich]",
    JSON.stringify({
      phase: "start",
      templateGraphId: args.templateGraphId ?? null,
      templateName: args.templateName,
      language: args.languageCode,
      inputPayloadAlreadyHasFlowButton: sendPayloadAlreadyHasFlowButton(base),
    }),
  );

  if (sendPayloadAlreadyHasFlowButton(base)) {
    const existingTok = extractFlowTokenFromSendComponents(base);
    const out = base.length ? base : undefined;
    console.log(
      "[meta-flow-enrich]",
      JSON.stringify({
        phase: "final_components",
        reason: "input_already_has_flow_button",
        components: out ?? [],
      }),
    );
    return { components: out, flowToken: existingTok };
  }

  const resolved = await resolveTemplateDefinitionRow(client, {
    templateName: args.templateName,
    languageCode: args.languageCode,
    templateGraphId: args.templateGraphId ?? null,
    strictFlowEnrich,
  });
  const row = resolved.row;
  console.log(
    "[meta-flow-enrich]",
    JSON.stringify({
      phase: "after_resolve_definition",
      definitionFound: row != null,
      resolutionPath: resolved.resolutionPath,
    }),
  );

  const flowIndex = getFlowButtonIndexFromTemplateDefinition(row?.components);
  const inspectedButtons = collectFlatButtonsFromDefinitionComponents(row?.components);
  console.log(
    "[meta-flow-enrich]",
    JSON.stringify({
      phase: "after_flow_button_index",
      flowButtonIndex: flowIndex,
      ...(flowIndex == null ? { inspectedDefinitionButtons: inspectedButtons } : {}),
    }),
  );

  if (flowIndex == null) {
    const out = base.length ? base : undefined;
    console.log(
      "[meta-flow-enrich]",
      JSON.stringify({
        phase: "final_components",
        reason: "no_flow_button_in_definition",
        components: out ?? [],
      }),
    );
    return { components: out, flowToken: null };
  }

  const token =
    typeof args.flowToken === "string" && args.flowToken.trim().length > 0
      ? args.flowToken.trim()
      : randomUUID();

  const flowBtn = buildFlowButtonComponent(flowIndex, token, args.flowActionData ?? null);
  const merged = [...base, flowBtn];

  if (strictFlowEnrich && !sendPayloadAlreadyHasFlowButton(merged)) {
    throw new MetaFlowEnrichError(
      `[meta-flow-enrich] Template "${args.templateName}" define botão Flow (índice ${flowIndex}) mas o payload não contém componente button/flow após enriquecimento.`,
    );
  }

  console.log(
    "[meta-flow-enrich]",
    JSON.stringify({
      phase: "final_components",
      reason: "flow_button_appended",
      components: merged,
    }),
  );

  return { components: merged, flowToken: token };
}
