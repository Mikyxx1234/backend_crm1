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

  /** Filtros por origem (Contact.source). */
  sources?: string[];

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
};

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

type DateBounds = { gte?: Date; lte?: Date };

function dateRangeBounds(range: DateRangeValue | undefined): DateBounds | undefined {
  if (!range) return undefined;
  const gte = parseDate(range.from);
  const lte = parseDate(range.to);
  if (!gte && !lte) return undefined;
  const f: DateBounds = {};
  if (gte) f.gte = gte;
  if (lte) {
    const end = new Date(lte);
    end.setHours(23, 59, 59, 999);
    f.lte = end;
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
      if (/^\d+$/.test(search)) {
        const asNumber = Number(search);
        if (Number.isFinite(asNumber)) {
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

  if (filters.sources && filters.sources.length > 0) {
    conditions.push({ contact: { is: { source: { in: filters.sources } } } });
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
export function parseAdvancedDealFilters(input: unknown): AdvancedDealFilters {
  if (!input || typeof input !== "object") return {};
  return input as AdvancedDealFilters;
}
