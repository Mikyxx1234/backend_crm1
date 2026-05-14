/**
 * Pagina `message_templates` da Graph API e indexa por `id` (graph template id).
 * Usado pelo inbox (agent-enabled) e pelo script de backfill de metadados.
 */

type GraphRow = Record<string, unknown>;

function extractAfter(raw: unknown): string | undefined {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const paging = o?.paging as Record<string, unknown> | undefined;
  const cursors = paging?.cursors as Record<string, unknown> | undefined;
  const a = cursors?.after;
  return typeof a === "string" && a.length > 0 ? a : undefined;
}

export type MessageTemplateGraphHit = {
  components: unknown[];
  parameterFormat: string | null;
};

export async function listMessageTemplatesByGraphId(client: {
  listMessageTemplates: (o?: { limit?: number; after?: string }) => Promise<unknown>;
}): Promise<Map<string, MessageTemplateGraphHit>> {
  const map = new Map<string, MessageTemplateGraphHit>();
  let after: string | undefined;
  do {
    const raw = await client.listMessageTemplates({ limit: 500, after });
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const data = Array.isArray(o.data) ? (o.data as GraphRow[]) : [];
    for (const row of data) {
      const id = typeof row.id === "string" ? row.id : null;
      const comps = row.components;
      const pf = typeof row.parameter_format === "string" ? row.parameter_format : null;
      if (id && Array.isArray(comps)) {
        map.set(id, { components: comps as unknown[], parameterFormat: pf });
      }
    }
    after = extractAfter(raw);
  } while (after);
  return map;
}
