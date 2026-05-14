import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { requireAdmin, requireAuth, userOrgFilter } from "@/lib/auth-helpers";
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
        agentStatus: {
          select: {
            status: true,
            availableForVoiceCalls: true,
            updatedAt: true,
          },
        },
      },
    });

    return NextResponse.json(users);
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

    const user = await prisma.user.create({
      data: {
        name,
        email,
        hashedPassword,
        role: validRole,
        organization: { connect: { id: orgId } },
      },
      select: { id: true, name: true, email: true, role: true },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (e: unknown) {
    const prismaErr = e as { code?: string };
    if (prismaErr.code === "P2002") {
      return NextResponse.json({ message: "E-mail já cadastrado." }, { status: 409 });
    }
    console.error(e);
    return NextResponse.json({ message: "Erro ao criar usuário." }, { status: 500 });
  }
}
