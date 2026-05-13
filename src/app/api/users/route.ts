import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { requireAdmin, requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const VALID_ROLES = ["ADMIN", "MANAGER", "MEMBER"] as const;

export async function GET() {
  try {
    // Listagem de usuários é OK para qualquer usuário logado — vários
    // componentes (assignar conversa, dropdown de owner, etc.) precisam
    // dessa lista. O que NÃO pode acontecer é qualquer um criar/editar
    // usuários: isso é restrito a ADMIN no POST/PUT/DELETE.
    const r = await requireAuth();
    if (!r.ok) return r.response;

    const users = await prisma.user.findMany({
      // Apenas operadores humanos aparecem aqui. Agentes de IA
      // (User.type=AI) têm tela própria em /ai-agents e não fazem
      // sentido em seletores de "assinar conversa para mim" etc.
      where: { type: "HUMAN" },
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
    // Criar usuário (especialmente com role ADMIN/MANAGER) só pode ser
    // feito por outro ADMIN. Antes qualquer sessão autenticada conseguia
    // se promover a ADMIN via POST aqui — escalada de privilégio direta.
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

    const user = await prisma.user.create({
      data: { name, email, hashedPassword, role: validRole },
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
