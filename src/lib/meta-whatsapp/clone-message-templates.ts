import { formatMetaSendError, type MetaWhatsAppClient } from "./client";

type GraphRow = Record<string, unknown>;

function extractAfter(raw: unknown): string | undefined {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const paging = o?.paging as Record<string, unknown> | undefined;
  const cursors = paging?.cursors as Record<string, unknown> | undefined;
  const a = cursors?.after;
  return typeof a === "string" && a.length > 0 ? a : undefined;
}

function templateKey(name: string, language: string): string {
  return `${name}::${language}`;
}

export async function listAllMessageTemplates(
  client: MetaWhatsAppClient,
): Promise<GraphRow[]> {
  const out: GraphRow[] = [];
  let after: string | undefined;
  do {
    const raw = await client.listMessageTemplates({ limit: 500, after });
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const data = Array.isArray(o.data) ? (o.data as GraphRow[]) : [];
    out.push(...data);
    after = extractAfter(raw);
  } while (after);
  return out;
}

/**
 * Monta o body de create a partir de uma linha de listagem Graph.
 * Remove id/status/quality — a Meta exige re-aprovação no destino.
 */
export function buildCloneCreatePayload(row: GraphRow): Record<string, unknown> | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const language = typeof row.language === "string" ? row.language.trim() : "";
  const category = typeof row.category === "string" ? row.category.trim().toUpperCase() : "";
  if (!name || !language || !category) return null;
  if (!Array.isArray(row.components)) return null;

  const payload: Record<string, unknown> = {
    name,
    language,
    category,
    components: row.components,
  };

  const pf = typeof row.parameter_format === "string" ? row.parameter_format.trim() : "";
  if (pf && (category === "MARKETING" || category === "UTILITY")) {
    payload.parameter_format = pf;
  }

  return payload;
}

export type CloneMessageTemplatesResult = {
  sourceWabaId: string;
  targetWabaId: string;
  created: Array<{ name: string; language: string; id?: string }>;
  skipped: Array<{ name: string; language: string; reason: string }>;
  failed: Array<{ name: string; language: string; error: string }>;
};

export async function cloneMessageTemplatesBetweenClients(args: {
  source: MetaWhatsAppClient;
  target: MetaWhatsAppClient;
  skipNames?: string[];
}): Promise<CloneMessageTemplatesResult> {
  const skip = new Set(
    (args.skipNames?.length ? args.skipNames : ["hello_world"]).map((n) =>
      n.trim().toLowerCase(),
    ),
  );

  const sourceRows = await listAllMessageTemplates(args.source);
  const targetRows = await listAllMessageTemplates(args.target);
  const existingOnTarget = new Set(
    targetRows
      .map((r) => {
        const name = typeof r.name === "string" ? r.name.trim() : "";
        const language = typeof r.language === "string" ? r.language.trim() : "";
        return name && language ? templateKey(name, language) : "";
      })
      .filter(Boolean),
  );

  const created: CloneMessageTemplatesResult["created"] = [];
  const skipped: CloneMessageTemplatesResult["skipped"] = [];
  const failed: CloneMessageTemplatesResult["failed"] = [];

  for (const row of sourceRows) {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const language = typeof row.language === "string" ? row.language.trim() : "";
    if (!name || !language) {
      skipped.push({ name: name || "?", language: language || "?", reason: "linha sem name/language" });
      continue;
    }
    if (skip.has(name.toLowerCase())) {
      skipped.push({ name, language, reason: "skipNames" });
      continue;
    }
    if (existingOnTarget.has(templateKey(name, language))) {
      skipped.push({ name, language, reason: "já existe no destino (mesmo name+language)" });
      continue;
    }

    const payload = buildCloneCreatePayload(row);
    if (!payload) {
      skipped.push({ name, language, reason: "payload incompleto (category/components)" });
      continue;
    }

    try {
      const raw = await args.target.createMessageTemplate(payload);
      const createdId =
        raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).id === "string"
          ? String((raw as Record<string, unknown>).id)
          : undefined;
      created.push({ name, language, id: createdId });
      existingOnTarget.add(templateKey(name, language));
    } catch (err) {
      failed.push({ name, language, error: formatMetaSendError(err) });
    }
  }

  return {
    sourceWabaId: args.source.wabaId,
    targetWabaId: args.target.wabaId,
    created,
    skipped,
    failed,
  };
}
