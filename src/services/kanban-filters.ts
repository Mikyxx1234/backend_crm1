/**
 * Filtros avançados do Kanban de deals.
 *
 * O cliente envia um objeto `AdvancedDealFilters` (livre, validado em
 * runtime) e o serviço traduz para `Prisma.DealWhereInput` somando ao
 * `where` base usado por `getBoardData` e listagens.
 *
 * Mantemos schema livre (JSON) na tabela `saved_filters` para evoluir
 * sem migration nova a cada operador.
 */

import type { DealStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";

/**
 * Quando o termo de busca contém >=3 dígitos, casa o input contra o
 * telefone do contato **normalizado** (somente dígitos). Suporta o caso
 * comum: usuário digita "11945010493" mas telefone está salvo como
 * "+55 (11) 94501-0493" ou variações.
 */
async function findContactIdsByPhoneDigits(
  digits: string,
): Promise<string[]> {
  if (digits.length < 3) return [];
  const ctx = getRequestContext();
  const orgId = ctx?.organizationId;
  if (!orgId) return [];
  // regexp_replace remove tudo que não é dígito; LIKE faz substring match.
  // Limitamos a 500 IDs para não explodir o IN.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM contacts
    WHERE "organizationId" = ${orgId}
      AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') LIKE ${"%" + digits + "%"}
    LIMIT 500
  `;
  return rows.map((r) => r.id);
}

export type DateRangeValue = {
  from?: string | null;
  to?: string | null;
};

/** Sentinela usada no filtro de origem para "Sem origem" (espelha o dashboard). */
export const SOURCE_NONE = "__none__";

export type CustomFieldFilter = {
  /** Nome (slug) do CustomField — único por organizationId+entity. */
  name: string;
  /** Default: contains se value, filled caso contrário. */
  operator?:
    | "eq"
    | "neq"
    | "contains"
    | "not_contains"
    | "filled"
    | "empty"
    | "gt"
    | "lt"
    | "between"
    | "before"
    | "after"
    | "in";
  value?: string | string[] | DateRangeValue | null;
};

export type AdvancedDealFilters = {
  /** AND (todos) | OR (qualquer). Aplica-se à lista `customFilters` adicionais. */
  logic?: "AND" | "OR";

  search?: string;

  /** Pipeline (filtra pela stage.pipelineId). */
  pipelineId?: string;
  /** IDs de etapa (OR entre elas). */
  stageIds?: string[];
  /** Status do deal. */
  statuses?: DealStatus[];

  /** Responsáveis (deal.ownerId). Inclui "null" como "sem responsável". */
  ownerIds?: (string | null)[];
  /** true = só leads sem responsável. */
  withoutOwner?: boolean;
  /** true = só leads sem contato. */
  withoutContact?: boolean;

  /** Filtros por origem (Contact.source). Pode incluir `SOURCE_NONE`. */
  sources?: string[];
  /** true = só leads sem origem (contato ausente ou source null/""). */
  withoutSource?: boolean;

  /** Motivos de perda (Deal.lostReason) — match exato com a tabulação. */
  lostReasons?: string[];

  /** Tags do deal. */
  tagIds?: string[];
  /** any (qualquer) | all (todas) | none (sem nenhuma das informadas). */
  tagMode?: "any" | "all" | "none";
  /** true = só leads sem nenhuma tag (independente de `tagIds`). */
  withoutTags?: boolean;

  /** Filtros por contato. */
  contactSearch?: string;
  contactHasPhone?: boolean;
  contactHasEmail?: boolean;

  /** Datas: campo + intervalo. */
  createdAt?: DateRangeValue;
  updatedAt?: DateRangeValue;
  closedAt?: DateRangeValue;
  /** Último contato (última mensagem inbound ou outbound). */
  lastInteractionAt?: DateRangeValue;

  /** Campos personalizados de deal/contato. */
  dealCustomFields?: CustomFieldFilter[];
  contactCustomFields?: CustomFieldFilter[];

  /**
   * Filtros de conversa do contato (via Contact.conversations.some).
   * `conversationStatus`: "open" = alguma conversa não resolvida / "closed" = alguma resolvida.
   * `lastMessageDirection`: "out" = última msg nossa / "in" = última msg do cliente.
   */
  conversationStatus?: "open" | "closed";
  lastMessageDirection?: "in" | "out";
};

/**
 * Aceita "YYYY-MM-DD" (data pura) e ISO completo. Para data pura,
 * retornamos o inicio do dia em UTC — quem chama decide se quer
 * estender pro fim do dia (ver `dateRangeBounds`).
 */
function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

type DateBounds = { gte?: Date; lte?: Date };

/**
 * Converte um range "YYYY-MM-DD" do front em bounds Date para o Prisma.
 *
 * - `from` -> gte = inicio do dia UTC do `from`
 * - `to`   -> lte = fim do dia UTC do `to` (23:59:59.999)
 *
 * Nota timezone: comparamos em UTC. Para a maioria das aplicacoes
 * isso e "good enough" — se o dataset for sensivel a fuso, o usuario
 * pode usar "Personalizado" e definir horarios explicitos.
 */
function dateRangeBounds(range: DateRangeValue | undefined): DateBounds | undefined {
  if (!range) return undefined;
  const gte = parseDate(range.from);
  const lteStart = parseDate(range.to);
  if (!gte && !lteStart) return undefined;
  const f: DateBounds = {};
  if (gte) f.gte = gte;
  if (lteStart) {
    // Se o `to` veio como data pura (00:00 UTC), avanca pra 23:59:59.999
    // do mesmo dia UTC para abranger todo o dia.
    const isMidnightUtc =
      lteStart.getUTCHours() === 0 &&
      lteStart.getUTCMinutes() === 0 &&
      lteStart.getUTCSeconds() === 0 &&
      lteStart.getUTCMilliseconds() === 0;
    if (isMidnightUtc) {
      const end = new Date(lteStart);
      end.setUTCHours(23, 59, 59, 999);
      f.lte = end;
    } else {
      f.lte = lteStart;
    }
  }
  return f;
}

function isDateRangeValue(v: unknown): v is DateRangeValue {
  return !!v && typeof v === "object" && !Array.isArray(v) && ("from" in v || "to" in v);
}

/**
 * Custom fields são armazenados como STRING no DB (`value` em
 * `ContactCustomFieldValue`/`DealCustomFieldValue`).
 *
 * Para datas convertemos pra ISO/`YYYY-MM-DD` e comparamos lexicograficamente.
 * Funciona porque ISO-8601 é monotonicamente comparável como string.
 * Para `gt`/`lt` em campos numéricos, idem (somente faz sentido se o
 * usuário cadastrou números com padding consistente — limitação documentada).
 */
function buildContactCustomFieldClause(
  customFieldId: string,
  filter: CustomFieldFilter,
): Prisma.ContactWhereInput | null {
  const op = filter.operator ?? (filter.value ? "contains" : "filled");
  const valueStr = typeof filter.value === "string" ? filter.value.trim() : "";
  const valueArr = Array.isArray(filter.value) ? filter.value.filter(Boolean) : [];
  const range = isDateRangeValue(filter.value) ? filter.value : null;

  switch (op) {
    case "filled":
      return { customFields: { some: { customFieldId, value: { not: "" } } } };
    case "empty":
      return {
        OR: [
          { customFields: { none: { customFieldId } } },
          { customFields: { some: { customFieldId, value: "" } } },
        ],
      };
    case "eq":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: valueStr } } };
    case "neq":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { not: valueStr } } } };
    case "contains":
      if (!valueStr) return null;
      return {
        customFields: {
          some: { customFieldId, value: { contains: valueStr, mode: "insensitive" } },
        },
      };
    case "not_contains":
      if (!valueStr) return null;
      return {
        NOT: {
          customFields: {
            some: { customFieldId, value: { contains: valueStr, mode: "insensitive" } },
          },
        },
      };
    case "in":
      if (valueArr.length === 0) return null;
      return { customFields: { some: { customFieldId, value: { in: valueArr } } } };
    case "gt":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { gt: valueStr } } } };
    case "lt":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { lt: valueStr } } } };
    case "before":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { lt: valueStr } } } };
    case "after":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { gt: valueStr } } } };
    case "between": {
      if (!range || (!range.from && !range.to)) return null;
      const valueWhere: { gte?: string; lte?: string } = {};
      if (range.from) valueWhere.gte = range.from;
      if (range.to) valueWhere.lte = range.to;
      return { customFields: { some: { customFieldId, value: valueWhere } } };
    }
    default:
      return null;
  }
}

function buildDealCustomFieldClause(
  customFieldId: string,
  filter: CustomFieldFilter,
): Prisma.DealWhereInput | null {
  const op = filter.operator ?? (filter.value ? "contains" : "filled");
  const valueStr = typeof filter.value === "string" ? filter.value.trim() : "";
  const valueArr = Array.isArray(filter.value) ? filter.value.filter(Boolean) : [];
  const range = isDateRangeValue(filter.value) ? filter.value : null;

  switch (op) {
    case "filled":
      return { customFields: { some: { customFieldId, value: { not: "" } } } };
    case "empty":
      return {
        OR: [
          { customFields: { none: { customFieldId } } },
          { customFields: { some: { customFieldId, value: "" } } },
        ],
      };
    case "eq":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: valueStr } } };
    case "neq":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { not: valueStr } } } };
    case "contains":
      if (!valueStr) return null;
      return {
        customFields: {
          some: { customFieldId, value: { contains: valueStr, mode: "insensitive" } },
        },
      };
    case "not_contains":
      if (!valueStr) return null;
      return {
        NOT: {
          customFields: {
            some: { customFieldId, value: { contains: valueStr, mode: "insensitive" } },
          },
        },
      };
    case "in":
      if (valueArr.length === 0) return null;
      return { customFields: { some: { customFieldId, value: { in: valueArr } } } };
    case "gt":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { gt: valueStr } } } };
    case "lt":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { lt: valueStr } } } };
    case "before":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { lt: valueStr } } } };
    case "after":
      if (!valueStr) return null;
      return { customFields: { some: { customFieldId, value: { gt: valueStr } } } };
    case "between": {
      if (!range || (!range.from && !range.to)) return null;
      const valueWhere: { gte?: string; lte?: string } = {};
      if (range.from) valueWhere.gte = range.from;
      if (range.to) valueWhere.lte = range.to;
      return { customFields: { some: { customFieldId, value: valueWhere } } };
    }
    default:
      return null;
  }
}

/**
 * Condição de origem em cima do contato do deal, com suporte a
 * "Sem origem" (contato com source null/"" ou deal sem contato).
 */
function buildDealSourceCondition(
  sources?: string[],
  withoutSource?: boolean,
): Prisma.DealWhereInput | null {
  const real = (sources ?? []).filter((s) => s && s !== SOURCE_NONE);
  const wantNone = withoutSource === true || (sources ?? []).includes(SOURCE_NONE);
  const or: Prisma.DealWhereInput[] = [];
  if (real.length) or.push({ contact: { is: { source: { in: real } } } });
  if (wantNone) {
    or.push({
      OR: [
        { contactId: null },
        { contact: { is: { source: null } } },
        { contact: { is: { source: "" } } },
      ],
    });
  }
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { OR: or };
}

/**
 * Traduz `AdvancedDealFilters` para `Prisma.DealWhereInput`.
 * O retorno deve ser somado às outras condições via `AND` em `dealWhere`.
 */
export async function buildDealWhereFromFilters(
  filters: AdvancedDealFilters,
): Promise<Prisma.DealWhereInput[]> {
  const conditions: Prisma.DealWhereInput[] = [];

  const search = filters.search?.trim();
  if (search) {
    const or: Prisma.DealWhereInput[] = [
      { title: { contains: search, mode: "insensitive" } },
      { contact: { name: { contains: search, mode: "insensitive" } } },
      { contact: { email: { contains: search, mode: "insensitive" } } },
      { contact: { phone: { contains: search } } },
      // Busca em QUALQUER valor de campo personalizado (RGM, CPF, matrícula,
      // etc.) — tanto do negócio quanto do contato vinculado. Espelha o que a
      // lista de contatos já faz (services/contacts.ts).
      { customFields: { some: { value: { contains: search, mode: "insensitive" } } } },
      {
        contact: {
          customFields: { some: { value: { contains: search, mode: "insensitive" } } },
        },
      },
    ];

    // Casa busca por telefone independente da formatação salva no banco.
    const digits = search.replace(/\D+/g, "");
    if (digits.length >= 3) {
      const contactIds = await findContactIdsByPhoneDigits(digits);
      if (contactIds.length > 0) {
        or.push({ contactId: { in: contactIds } });
      }
      // Se a busca é PURAMENTE numérica, também tenta casar o número do
      // próprio deal (`#123` na busca → match no `number`).
      // IMPORTANTE: `Deal.number` é Int (int4, máx 2.147.483.647). Buscas
      // numéricas longas (CPF, RGM, telefone) estouram esse limite e fazem
      // o Postgres abortar a query inteira ("value out of range for type
      // integer") — por isso só aplicamos o match quando cabe no int32.
      if (/^\d+$/.test(search)) {
        const asNumber = Number(search);
        if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= 2147483647) {
          or.push({ number: asNumber });
        }
      }
    }

    conditions.push({ OR: or });
  }

  if (filters.pipelineId) {
    conditions.push({ stage: { pipelineId: filters.pipelineId } });
  }

  if (filters.stageIds && filters.stageIds.length > 0) {
    conditions.push({ stageId: { in: filters.stageIds } });
  }

  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push({ status: { in: filters.statuses } });
  }

  // Responsável
  if (filters.withoutOwner) {
    conditions.push({ ownerId: null });
  } else if (filters.ownerIds && filters.ownerIds.length > 0) {
    const realIds = filters.ownerIds.filter((id): id is string => !!id);
    const hasNull = filters.ownerIds.some((id) => id === null);
    if (hasNull && realIds.length > 0) {
      conditions.push({ OR: [{ ownerId: null }, { ownerId: { in: realIds } }] });
    } else if (hasNull) {
      conditions.push({ ownerId: null });
    } else if (realIds.length > 0) {
      conditions.push({ ownerId: { in: realIds } });
    }
  }

  if (filters.withoutContact) {
    conditions.push({ contactId: null });
  }

  const sourceCond = buildDealSourceCondition(filters.sources, filters.withoutSource);
  if (sourceCond) conditions.push(sourceCond);

  if (filters.lostReasons && filters.lostReasons.length > 0) {
    conditions.push({ lostReason: { in: filters.lostReasons } });
  }

  // Tags
  if (filters.withoutTags) {
    conditions.push({ tags: { none: {} } });
  } else if (filters.tagIds && filters.tagIds.length > 0) {
    const ids = filters.tagIds;
    const mode = filters.tagMode ?? "any";
    if (mode === "any") {
      conditions.push({ tags: { some: { tagId: { in: ids } } } });
    } else if (mode === "all") {
      // todas: cada tag deve aparecer
      for (const tagId of ids) {
        conditions.push({ tags: { some: { tagId } } });
      }
    } else if (mode === "none") {
      conditions.push({ tags: { none: { tagId: { in: ids } } } });
    }
  }

  // Contato
  const contactSearch = filters.contactSearch?.trim();
  if (contactSearch) {
    conditions.push({
      contact: {
        is: {
          OR: [
            { name: { contains: contactSearch, mode: "insensitive" } },
            { email: { contains: contactSearch, mode: "insensitive" } },
            { phone: { contains: contactSearch } },
          ],
        },
      },
    });
  }
  if (filters.contactHasPhone === true) {
    conditions.push({ contact: { is: { phone: { not: null } } } });
  } else if (filters.contactHasPhone === false) {
    conditions.push({ contact: { is: { phone: null } } });
  }
  if (filters.contactHasEmail === true) {
    conditions.push({ contact: { is: { email: { not: null } } } });
  } else if (filters.contactHasEmail === false) {
    conditions.push({ contact: { is: { email: null } } });
  }

  // Datas
  const created = dateRangeBounds(filters.createdAt);
  if (created) conditions.push({ createdAt: { ...created } });
  const updated = dateRangeBounds(filters.updatedAt);
  if (updated) conditions.push({ updatedAt: { ...updated } });
  const closed = dateRangeBounds(filters.closedAt);
  if (closed) conditions.push({ closedAt: { ...closed } });
  const lastInter = dateRangeBounds(filters.lastInteractionAt);
  if (lastInter) {
    // proxy: última mensagem da conversation do contato
    conditions.push({
      contact: {
        is: {
          conversations: {
            some: { lastInboundAt: { ...lastInter } },
          },
        },
      },
    });
  }

  // Filtros de conversa (status + direção da última mensagem). Combinados no
  // MESMO `some` para casar a mesma conversation quando ambos estão ativos.
  {
    const convSome: Prisma.ConversationWhereInput = {};
    if (filters.conversationStatus === "open") convSome.status = { not: "RESOLVED" };
    else if (filters.conversationStatus === "closed") convSome.status = "RESOLVED";
    if (filters.lastMessageDirection === "in" || filters.lastMessageDirection === "out") {
      convSome.lastMessageDirection = filters.lastMessageDirection;
    }
    if (Object.keys(convSome).length > 0) {
      conditions.push({ contact: { is: { conversations: { some: convSome } } } });
    }
  }

  // Custom fields (Deal)
  if (filters.dealCustomFields && filters.dealCustomFields.length > 0) {
    const names = filters.dealCustomFields.map((f) => f.name.trim()).filter(Boolean);
    if (names.length > 0) {
      const defs = await prisma.customField.findMany({
        where: { entity: "deal", name: { in: names } },
        select: { id: true, name: true },
      });
      const byName = new Map(defs.map((d) => [d.name, d.id]));
      for (const f of filters.dealCustomFields) {
        const id = byName.get(f.name.trim());
        if (!id) continue;
        const clause = buildDealCustomFieldClause(id, f);
        if (clause) conditions.push(clause);
      }
    }
  }

  // Custom fields (Contact)
  if (filters.contactCustomFields && filters.contactCustomFields.length > 0) {
    const names = filters.contactCustomFields.map((f) => f.name.trim()).filter(Boolean);
    if (names.length > 0) {
      const defs = await prisma.customField.findMany({
        where: { entity: "contact", name: { in: names } },
        select: { id: true, name: true },
      });
      const byName = new Map(defs.map((d) => [d.name, d.id]));
      for (const f of filters.contactCustomFields) {
        const id = byName.get(f.name.trim());
        if (!id) continue;
        const clause = buildContactCustomFieldClause(id, f);
        if (clause) conditions.push({ contact: { is: clause } });
      }
    }
  }

  return conditions;
}

/**
 * Parse defensivo do body do cliente. Retorna `null` se o input não
 * for um objeto. Filtros desconhecidos são silenciosamente ignorados.
 */
/**
 * Operadores aceitos em CustomField. Mantenha sincronizado com a union
 * em `CustomFieldFilter.operator`.
 */
const CUSTOM_FIELD_OPS = new Set([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "filled",
  "empty",
  "gt",
  "lt",
  "between",
  "before",
  "after",
  "in",
]);

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return arr.length > 0 ? arr : undefined;
}

function asDateRange(v: unknown): DateRangeValue | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as { from?: unknown; to?: unknown };
  const from = typeof r.from === "string" ? r.from : null;
  const to = typeof r.to === "string" ? r.to : null;
  if (!from && !to) return undefined;
  return { from, to };
}

function asCustomFieldFilter(v: unknown): CustomFieldFilter | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = asString(o.name);
  if (!name) return null;
  const operator =
    typeof o.operator === "string" && CUSTOM_FIELD_OPS.has(o.operator)
      ? (o.operator as CustomFieldFilter["operator"])
      : undefined;
  let value: CustomFieldFilter["value"];
  if (typeof o.value === "string") value = o.value;
  else if (Array.isArray(o.value)) {
    value = o.value.filter((x): x is string => typeof x === "string");
  } else if (o.value && typeof o.value === "object") {
    value = asDateRange(o.value) ?? null;
  } else {
    value = null;
  }
  return { name, operator, value };
}

function asCustomFieldArray(v: unknown): CustomFieldFilter[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CustomFieldFilter[] = [];
  for (const item of v) {
    const f = asCustomFieldFilter(item);
    if (f) out.push(f);
  }
  return out.length > 0 ? out : undefined;
}

const VALID_DEAL_STATUSES = new Set(["OPEN", "WON", "LOST"]);
const VALID_TAG_MODES = new Set(["any", "all", "none"]);

/**
 * Sanitiza/valida o payload recebido do cliente. Ignora campos
 * desconhecidos e descarta valores invalidos. Nunca quebra — sempre
 * devolve um objeto valido (potencialmente vazio).
 */
export function parseAdvancedDealFilters(input: unknown): AdvancedDealFilters {
  if (!input || typeof input !== "object") return {};
  const o = input as Record<string, unknown>;
  const out: AdvancedDealFilters = {};

  if (o.logic === "AND" || o.logic === "OR") out.logic = o.logic;

  const search = asString(o.search);
  if (search) out.search = search;

  const pipelineId = asString(o.pipelineId);
  if (pipelineId) out.pipelineId = pipelineId;

  const stageIds = asStringArray(o.stageIds);
  if (stageIds) out.stageIds = stageIds;

  const statuses = asStringArray(o.statuses)?.filter((s) =>
    VALID_DEAL_STATUSES.has(s),
  ) as DealStatus[] | undefined;
  if (statuses && statuses.length > 0) out.statuses = statuses;

  // ownerIds aceita null como "sem responsavel"
  if (Array.isArray(o.ownerIds)) {
    const owners = o.ownerIds.filter(
      (x): x is string | null => x === null || (typeof x === "string" && x.trim().length > 0),
    );
    if (owners.length > 0) out.ownerIds = owners;
  }
  const wo = asBool(o.withoutOwner);
  if (wo) out.withoutOwner = wo;
  const wc = asBool(o.withoutContact);
  if (wc) out.withoutContact = wc;

  const sources = asStringArray(o.sources);
  if (sources) out.sources = sources;
  const ws = asBool(o.withoutSource);
  if (ws) out.withoutSource = ws;

  const lostReasons = asStringArray(o.lostReasons);
  if (lostReasons) out.lostReasons = lostReasons;

  const tagIds = asStringArray(o.tagIds);
  if (tagIds) out.tagIds = tagIds;
  if (typeof o.tagMode === "string" && VALID_TAG_MODES.has(o.tagMode)) {
    out.tagMode = o.tagMode as "any" | "all" | "none";
  }
  const wt = asBool(o.withoutTags);
  if (wt) out.withoutTags = wt;

  const contactSearch = asString(o.contactSearch);
  if (contactSearch) out.contactSearch = contactSearch;
  const chp = asBool(o.contactHasPhone);
  if (chp !== undefined) out.contactHasPhone = chp;
  const che = asBool(o.contactHasEmail);
  if (che !== undefined) out.contactHasEmail = che;

  const created = asDateRange(o.createdAt);
  if (created) out.createdAt = created;
  const updated = asDateRange(o.updatedAt);
  if (updated) out.updatedAt = updated;
  const closed = asDateRange(o.closedAt);
  if (closed) out.closedAt = closed;
  const lastI = asDateRange(o.lastInteractionAt);
  if (lastI) out.lastInteractionAt = lastI;

  const dealCfs = asCustomFieldArray(o.dealCustomFields);
  if (dealCfs) out.dealCustomFields = dealCfs;
  const contactCfs = asCustomFieldArray(o.contactCustomFields);
  if (contactCfs) out.contactCustomFields = contactCfs;

  if (o.conversationStatus === "open" || o.conversationStatus === "closed") {
    out.conversationStatus = o.conversationStatus;
  }
  if (o.lastMessageDirection === "in" || o.lastMessageDirection === "out") {
    out.lastMessageDirection = o.lastMessageDirection;
  }

  return out;
}
