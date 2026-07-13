/**
 * Núcleo compartilhado da importação de NEGÓCIOS (deals).
 *
 * Usado pela rota (`/api/deals/import`, validação rápida + enfileiramento) e
 * pelo handler do worker (`deal-import.job.ts`, processamento em lote). Mantém
 * as constantes/validações num só lugar para não divergirem.
 */

export type DealImportMode = "create" | "update" | "upsert";

/** Cabeçalhos padrão do negócio — não viram campo personalizado por nome. */
export const DEAL_RESERVED_HEADERS = new Set<string>([
  "id",
  "external_id",
  "externalid",
  "kommo_lead_id",
  "lead_external_id",
  "deal_number",
  "title",
  "value",
  "status",
  "pipeline",
  "pipeline_name",
  "stage",
  "stage_name",
  "stage_id",
  "stageid",
  "contact_id",
  "contactid",
  "contact_name",
  "contactname",
  "contact",
  "contact_email",
  "contactemail",
  "contact_phone",
  "contactphone",
  "contact_external_id",
  "contact_externalid",
  "kommo_contact_id",
  "owner_id",
  "ownertoid",
  "owner_email",
  "owneremail",
  "expected_close",
  "expectedclose",
  "lost_reason",
  "lostreason",
]);

/**
 * Deriva os flags de comportamento a partir do modo. `updateExisting` é o flag
 * legado usado quando o cliente não envia `importMode`.
 *   - allowCreate: cria quando NÃO há negócio correspondente.
 *   - allowUpdate: atualiza quando HÁ negócio correspondente.
 */
export function resolveImportModeFlags(
  mode: DealImportMode | null,
  updateExisting: boolean,
): { allowCreate: boolean; allowUpdate: boolean } {
  return {
    allowCreate: mode ? mode !== "update" : true,
    allowUpdate: mode ? mode !== "create" : updateExisting,
  };
}

/**
 * Valida os cabeçalhos do arquivo. `title` é sempre obrigatório; o estágio
 * (stage_id OU pipeline_name+stage_name) só é obrigatório quando o import pode
 * criar negócios novos (modos create/upsert) — no modo "update" atualizar dados
 * sem mexer na etapa é legítimo.
 *
 * Retorna a mensagem de erro (string) ou `null` se OK.
 */
export function validateDealImportHeaders(
  headers: string[],
  allowCreate: boolean,
): string | null {
  if (headers.length === 0 || !headers.includes("title")) {
    return 'CSV inválido: coluna "title" obrigatória. Informe "stage_id" ou "pipeline_name" + "stage_name".';
  }

  const hasStage = headers.includes("stage_id") || headers.includes("stageid");
  const hasPipelineStage =
    (headers.includes("pipeline_name") || headers.includes("pipeline")) &&
    (headers.includes("stage_name") || headers.includes("stage"));

  if (allowCreate && !hasStage && !hasPipelineStage) {
    return 'Inclua "stage_id" (recomendado) ou o par "pipeline_name" + "stage_name" para localizar o estágio.';
  }

  return null;
}

/** ISO/date parse tolerante. `undefined` = vazio; `null` = inválido. */
export function parseDealExpectedClose(
  raw: string | undefined,
): Date | null | undefined {
  if (!raw?.trim()) return undefined;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Parse do valor monetário. `undefined` = vazio; `null` = inválido. */
export function parseDealValue(
  raw: string | undefined,
): number | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const n = Number.parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Extrai o external_id da linha (aceita aliases). `null` = coluna vazia. */
export function pickRowExternalId(row: Record<string, string>): string | null {
  const v =
    row.external_id?.trim() ||
    row.externalid?.trim() ||
    row.kommo_lead_id?.trim() ||
    row.lead_external_id?.trim() ||
    "";
  return v === "" ? null : v;
}
