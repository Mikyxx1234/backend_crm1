import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

const assignedToSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  role: true,
} satisfies Prisma.UserSelect;

export type CompanySegment = "todos" | "com-contatos" | "sem-email" | "sem-telefone";

export type CompanySortField = "name" | "createdAt" | "updatedAt";
export type SortOrder = "asc" | "desc";

export type GetCompaniesParams = {
  search?: string;
  page?: number;
  perPage?: number;
  /** Segmento dos stat cards do diretório. */
  segment?: CompanySegment;
  /** Filtro por localização. */
  city?: string;
  state?: string;
  /** Filtro por setor/indústria. */
  industry?: string;
  /** Intervalo de criação (YYYY-MM-DD). */
  createdFrom?: string;
  createdTo?: string;
  /** Ordenação. */
  sortBy?: CompanySortField;
  sortOrder?: SortOrder;
};

function buildCompanyWhere(params: {
  search?: string;
  segment?: CompanySegment;
  city?: string;
  state?: string;
  industry?: string;
  createdFrom?: string;
  createdTo?: string;
}): Prisma.CompanyWhereInput {
  const search = params.search?.trim();
  const and: Prisma.CompanyWhereInput[] = [];

  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { domain: { contains: search, mode: "insensitive" } },
        { industry: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { state: { contains: search, mode: "insensitive" } },
        { cep: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { size: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  const city = params.city?.trim();
  if (city) and.push({ city: { equals: city, mode: "insensitive" } });

  const state = params.state?.trim();
  if (state) and.push({ state: { equals: state, mode: "insensitive" } });

  const industry = params.industry?.trim();
  if (industry) and.push({ industry: { equals: industry, mode: "insensitive" } });

  const createdRange = buildDateRange(params.createdFrom, params.createdTo);
  if (createdRange) and.push({ createdAt: createdRange });

  if (params.segment === "com-contatos") {
    and.push({ contacts: { some: {} } });
  } else if (params.segment === "sem-email") {
    and.push({ OR: [{ domain: null }, { domain: "" }] });
  } else if (params.segment === "sem-telefone") {
    and.push({ OR: [{ phone: null }, { phone: "" }] });
  }

  return and.length === 0 ? {} : and.length === 1 ? and[0]! : { AND: and };
}

/** Converte YYYY-MM-DD (from/to) em filtro de intervalo com fim inclusivo. */
function buildDateRange(
  from?: string,
  to?: string,
): Prisma.DateTimeFilter | undefined {
  const range: Prisma.DateTimeFilter = {};
  if (from) {
    const d = new Date(`${from}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) range.gte = d;
  }
  if (to) {
    const d = new Date(`${to}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + 1);
      range.lt = d;
    }
  }
  return range.gte || range.lt ? range : undefined;
}

const COMPANY_SORT_FIELDS = new Set<CompanySortField>(["name", "createdAt", "updatedAt"]);

export async function getCompanies(params: GetCompaniesParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;
  const where = buildCompanyWhere(params);

  const sortBy = params.sortBy && COMPANY_SORT_FIELDS.has(params.sortBy) ? params.sortBy : "name";
  const sortOrder: SortOrder = params.sortOrder === "desc" ? "desc" : "asc";

  const [items, total] = await Promise.all([
    prisma.company.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { [sortBy]: sortOrder },
      include: {
        _count: { select: { contacts: true } },
      },
    }),
    prisma.company.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage) || 1,
  };
}

export type CompanyStats = {
  total: number;
  withContacts: number;
  withoutEmail: number;
  withoutPhone: number;
};

/** Contagens agregadas para os stat cards do diretório de empresas. */
export async function getCompanyStats(): Promise<CompanyStats> {
  const [total, withContacts, withoutEmail, withoutPhone] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { contacts: { some: {} } } }),
    prisma.company.count({ where: { OR: [{ domain: null }, { domain: "" }] } }),
    prisma.company.count({ where: { OR: [{ phone: null }, { phone: "" }] } }),
  ]);

  return { total, withContacts, withoutEmail, withoutPhone };
}

export type CompanyFacets = {
  states: string[];
  cities: string[];
  industries: string[];
};

/** Valores distintos (estado, cidade, setor) para os selects do filtro. */
export async function getCompanyFacets(): Promise<CompanyFacets> {
  const [states, cities, industries] = await Promise.all([
    prisma.company.findMany({
      where: { state: { not: null } },
      select: { state: true },
      distinct: ["state"],
      orderBy: { state: "asc" },
    }),
    prisma.company.findMany({
      where: { city: { not: null } },
      select: { city: true },
      distinct: ["city"],
      orderBy: { city: "asc" },
    }),
    prisma.company.findMany({
      where: { industry: { not: null } },
      select: { industry: true },
      distinct: ["industry"],
      orderBy: { industry: "asc" },
    }),
  ]);

  return {
    states: states.map((s) => s.state!).filter((v) => v.trim() !== ""),
    cities: cities.map((c) => c.city!).filter((v) => v.trim() !== ""),
    industries: industries.map((i) => i.industry!).filter((v) => v.trim() !== ""),
  };
}

export type CreateCompanyInput = {
  name: string;
  domain?: string | null;
  industry?: string | null;
  size?: string | null;
  phone?: string | null;
  address?: string | null;
  cep?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
};

export type UpdateCompanyInput = Partial<CreateCompanyInput>;

export async function getCompanyById(id: string) {
  return prisma.company.findUnique({
    where: { id },
    include: {
      contacts: {
        orderBy: { name: "asc" },
        include: {
          assignedTo: { select: assignedToSelect },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      },
    },
  });
}

export async function createCompany(data: CreateCompanyInput) {
  return prisma.company.create({
    data: withOrgFromCtx({
      name: data.name,
      domain: data.domain ?? undefined,
      industry: data.industry ?? undefined,
      size: data.size ?? undefined,
      phone: data.phone ?? undefined,
      address: data.address ?? undefined,
      cep: data.cep ?? undefined,
      city: data.city ?? undefined,
      state: data.state ?? undefined,
      notes: data.notes ?? undefined,
    }),
    include: {
      _count: { select: { contacts: true } },
    },
  });
}

export async function updateCompany(id: string, data: UpdateCompanyInput) {
  const updateData: Prisma.CompanyUpdateInput = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.domain !== undefined) updateData.domain = data.domain;
  if (data.industry !== undefined) updateData.industry = data.industry;
  if (data.size !== undefined) updateData.size = data.size;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.cep !== undefined) updateData.cep = data.cep;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.notes !== undefined) updateData.notes = data.notes;

  return prisma.company.update({
    where: { id },
    data: updateData,
    include: {
      _count: { select: { contacts: true } },
    },
  });
}

export async function deleteCompany(id: string) {
  await prisma.$transaction([
    prisma.contact.updateMany({
      where: { companyId: id },
      data: { companyId: null },
    }),
    prisma.company.delete({ where: { id } }),
  ]);
}
