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

export type GetCompaniesParams = {
  search?: string;
  page?: number;
  perPage?: number;
  /** Segmento dos stat cards do diretório. */
  segment?: CompanySegment;
};

function buildCompanyWhere(params: {
  search?: string;
  segment?: CompanySegment;
}): Prisma.CompanyWhereInput {
  const search = params.search?.trim();
  const and: Prisma.CompanyWhereInput[] = [];

  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { domain: { contains: search, mode: "insensitive" } },
        { industry: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (params.segment === "com-contatos") {
    and.push({ contacts: { some: {} } });
  } else if (params.segment === "sem-email") {
    and.push({ OR: [{ domain: null }, { domain: "" }] });
  } else if (params.segment === "sem-telefone") {
    and.push({ OR: [{ phone: null }, { phone: "" }] });
  }

  return and.length === 0 ? {} : and.length === 1 ? and[0]! : { AND: and };
}

export async function getCompanies(params: GetCompaniesParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;
  const where = buildCompanyWhere(params);

  const [items, total] = await Promise.all([
    prisma.company.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { name: "asc" },
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

export type CreateCompanyInput = {
  name: string;
  domain?: string | null;
  industry?: string | null;
  size?: string | null;
  phone?: string | null;
  address?: string | null;
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
