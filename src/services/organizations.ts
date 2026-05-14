import { OrgStatus, Prisma, UserRole } from "@prisma/client";
import crypto from "node:crypto";

import { prismaBase } from "@/lib/prisma-base";
import { logAudit } from "@/lib/audit/log";

/**
 * Serviço global (super-admin only) de organizações. Usa `prismaBase`
 * — NAO passa pela Prisma Extension — porque super-admin precisa listar
 * e criar orgs cruzando tenants.
 *
 * Toda operação aqui deve ser gatteada por `requireSuperAdmin()` no
 * route handler. Nunca exponha funções deste arquivo pra rotas de
 * usuário comum.
 */

export type OrgListItem = {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  industry: string | null;
  size: string | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  userCount: number;
  contactCount: number;
};

export async function listOrganizations(params: {
  search?: string;
  status?: OrgStatus;
}): Promise<OrgListItem[]> {
  const where: Prisma.OrganizationWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
    ];
  }

  const orgs = await prismaBase.organization.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      industry: true,
      size: true,
      onboardingCompletedAt: true,
      createdAt: true,
      _count: {
        select: { users: true, contacts: true },
      },
    },
  });

  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    industry: o.industry,
    size: o.size,
    onboardingCompletedAt: o.onboardingCompletedAt,
    createdAt: o.createdAt,
    userCount: o._count.users,
    contactCount: o._count.contacts,
  }));
}

export async function getOrganizationById(id: string) {
  return prismaBase.organization.findUnique({
    where: { id },
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isSuperAdmin: true,
          type: true,
          isErased: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      invites: {
        where: { acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: {
          contacts: true,
          deals: true,
          pipelines: true,
          channels: true,
          conversations: true,
        },
      },
    },
  });
}

export async function updateOrganizationStatus(
  id: string,
  status: OrgStatus,
): Promise<void> {
  const before = await prismaBase.organization.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, status: true },
  });
  await prismaBase.organization.update({ where: { id }, data: { status } });
  await logAudit({
    entity: "organization",
    action: "update",
    entityId: id,
    organizationId: id,
    before: before ?? undefined,
    after: { ...before, status },
    metadata: { field: "status" },
  });
}

export async function createInviteForOrganization(params: {
  organizationId: string;
  email: string;
  role: UserRole;
  createdById: string;
}): Promise<{ token: string; expiresAt: Date; email: string }> {
  const email = params.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Email inválido.");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const inv = await prismaBase.organizationInvite.create({
    data: {
      organizationId: params.organizationId,
      email,
      role: params.role,
      token,
      expiresAt,
      createdById: params.createdById,
    },
  });
  await logAudit({
    entity: "organization",
    action: "invite_create",
    entityId: inv.id,
    organizationId: params.organizationId,
    actorId: params.createdById,
    after: {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
    },
  });
  return { token: inv.token, expiresAt: inv.expiresAt, email: inv.email };
}
