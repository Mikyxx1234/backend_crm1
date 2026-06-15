import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { requireAdmin, requireAuth, userOrgFilter } from "@/lib/auth-helpers";
import { syncUserRoleAssignment } from "@/lib/authz/sync-user-role";
import { prisma } from "@/lib/prisma";

const VALID_ROLES = ["ADMIN", "MANAGER", "MEMBER"] as const;

export async function GET() {
  try {
    const r = await requireAuth();
    if (!r.ok) return r.response;

    const users = await prisma.user.findMany({
      // Apenas operadores humanos aparecem aqui. Agentes de IA
      // (User.type=AI) têm tela própria em /ai-agents e não fazem
      // sentido em seletores de "assinar conversa para mim" etc.
      // userOrgFilter blinda o vazamento entre tenants — User nao esta
      // no SCOPED_MODELS da Prisma Extension (precisamos de auth sem ctx),
      // entao filtragem aqui e MANUAL e OBRIGATORIA.
      where: { type: "HUMAN", ...userOrgFilter(r.session) },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        // Roles RBAC atribuídas (modelo novo). Usado pela tela de Equipe
        // para exibir a "função" como role customizada (mantendo só ADMIN
        // como preset). NÃO substitui `role` legado — coexistem.
        roleAssignments: {
          select: {
            role: { select: { id: true, name: true, systemPreset: true } },
          },
        },
        agentStatus: {
          select: {
            status: true,
            availableForVoiceCalls: true,
            updatedAt: true,
          },
        },
      },
    });

    // Achata `roleAssignments` em `assignedRoles` (lista limpa pra UI).
    const shaped = users.map((u) => {
      const { roleAssignments, ...rest } = u;
      return {
        ...rest,
        assignedRoles: roleAssignments.map((a) => a.role),
      };
    });

    return NextResponse.json(shaped);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao listar usuários." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const r = await requireAdmin();
    if (!r.ok) return r.response;

    const body = await request.json();
    const { name, email, password, role } = body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
    };

    if (!name || !email || !password) {
      return NextResponse.json({ message: "Nome, email e senha são obrigatórios." }, { status: 400 });
    }

    // Normalizacao alinhada com PUT /api/users/[id]: trim sempre, e
    // lowercase no email pra que "Email@x" e "email@x" colidam na
    // unique constraint global (em vez de criarem o mesmo user "duas vezes").
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    const validRole = role && VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])
      ? (role as (typeof VALID_ROLES)[number])
      : "MEMBER";

    const hashedPassword = await bcrypt.hash(password, 10);

    // Critico: novo user precisa nascer dentro da org de quem criou.
    // Super-admin sem org ainda assim nao pode criar user orfao — bloqueia.
    const orgId = r.session.user.organizationId;
    if (!orgId) {
      return NextResponse.json(
        { message: "Super-admin precisa criar usuario via /admin/organizations." },
        { status: 400 },
      );
    }

    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: trimmedName,
            email: normalizedEmail,
            hashedPassword,
            role: validRole,
            organization: { connect: { id: orgId } },
          },
          select: { id: true, name: true, email: true, role: true },
        });
        await syncUserRoleAssignment(tx, {
          userId: created.id,
          organizationId: orgId,
          role: validRole,
          assignedById: r.session.user.id,
        });
        return created;
      });
      return NextResponse.json(user, { status: 201 });
    } catch (e: unknown) {
      const prismaErr = e as { code?: string };
      if (prismaErr.code === "P2002") {
        // Como User.email eh @unique GLOBAL, o duplicate pode estar em
        // OUTRA org (signup publico antigo, conta esquecida, etc) — caso
        // em que a UI de Equipe nao consegue ver/excluir o registro.
        // Diferenciamos pra mensagem dar o caminho de saida em vez de
        // virar misterio. User nao esta em SCOPED_MODELS, entao essa
        // query roda cross-tenant sem precisar de prismaBase.
        const existing = await prisma.user.findFirst({
          where: { email: normalizedEmail },
          select: {
            organizationId: true,
            organization: { select: { name: true } },
          },
        });
        if (
          existing &&
          existing.organizationId &&
          existing.organizationId !== orgId
        ) {
          const orgName = existing.organization?.name;
          return NextResponse.json(
            {
              message: orgName
                ? `E-mail já cadastrado em outra organização ("${orgName}"). Peça ao usuário para sair da outra ou contate o suporte.`
                : "E-mail já cadastrado em outra organização. Contate o suporte para liberar o convite.",
            },
            { status: 409 },
          );
        }
        return NextResponse.json({ message: "E-mail já cadastrado." }, { status: 409 });
      }
      throw e;
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao criar usuário." }, { status: 500 });
  }
}
