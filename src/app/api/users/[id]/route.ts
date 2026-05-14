import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { UserRole } from "@prisma/client";

import { requireAdmin, userOrgFilter } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const MIN_PASSWORD_LENGTH = 6;

type RouteContext = { params: Promise<{ id: string }> };

const ROLES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.MEMBER];

function isUserRole(v: string): v is UserRole {
  return ROLES.includes(v as UserRole);
}

function isP2025(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2025";
}

function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}

const userSelect = { id: true, name: true, email: true, role: true } as const;

export async function PUT(request: Request, context: RouteContext) {
  try {
    // Editar qualquer usuário (incluindo trocar role pra ADMIN) é
    // operação privilegiada. Para o usuário editar o próprio perfil
    // existe `/api/me` (não exige admin).
    const r = await requireAdmin();
    if (!r.ok) return r.response;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Corpo inválido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const data: {
      name?: string;
      email?: string;
      role?: UserRole;
      hashedPassword?: string;
    } = {};

    if (b.name !== undefined) {
      if (typeof b.name !== "string" || b.name.trim().length < 1) {
        return NextResponse.json({ message: "Nome inválido." }, { status: 400 });
      }
      data.name = b.name.trim();
    }

    if (b.email !== undefined) {
      if (typeof b.email !== "string" || b.email.trim().length < 1) {
        return NextResponse.json({ message: "E-mail inválido." }, { status: 400 });
      }
      data.email = b.email.trim().toLowerCase();
    }

    if (b.role !== undefined) {
      if (typeof b.role !== "string" || !isUserRole(b.role)) {
        return NextResponse.json({ message: "Função inválida." }, { status: 400 });
      }
      data.role = b.role;
    }

    // Troca de senha pelo ADMIN — não exige senha atual (é reset
    // administrativo, não troca via perfil próprio). O /api/profile é
    // quem cuida da troca em self-service e exige `currentPassword`.
    //
    // Agentes de IA (`type=AI`) não têm credencial de login, então
    // recusamos alterar senha pra evitar criar estado inválido.
    if (b.password !== undefined) {
      if (typeof b.password !== "string" || b.password.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          {
            message: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
          },
          { status: 400 },
        );
      }
      const target = await prisma.user.findUnique({
        where: { id },
        select: { type: true },
      });
      if (!target) {
        return NextResponse.json(
          { message: "Usuário não encontrado." },
          { status: 404 },
        );
      }
      if (target.type !== "HUMAN") {
        return NextResponse.json(
          { message: "Agentes de IA não possuem senha de acesso." },
          { status: 400 },
        );
      }
      data.hashedPassword = await bcrypt.hash(b.password, 10);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
    }

    try {
      const user = await prisma.user.update({
        where: { id },
        data,
        select: userSelect,
      });
      return NextResponse.json(user);
    } catch (e) {
      if (isP2025(e)) {
        return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
      }
      if (isP2002(e)) {
        return NextResponse.json({ message: "E-mail já em uso." }, { status: 409 });
      }
      throw e;
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao atualizar usuário." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const r = await requireAdmin();
    if (!r.ok) return r.response;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const target = await prisma.user.findFirst({
      where: { id, type: "HUMAN", ...userOrgFilter(r.session) },
      select: { id: true, role: true },
    });
    if (!target) {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }
    if (target.id === r.session.user.id) {
      return NextResponse.json({ message: "Você não pode excluir seu próprio usuário." }, { status: 400 });
    }
    if (target.role === "ADMIN") {
      const adminCount = await prisma.user.count({
        where: { type: "HUMAN", role: "ADMIN", ...userOrgFilter(r.session) },
      });
      if (adminCount <= 1) {
        return NextResponse.json(
          { message: "Não é possível excluir o último administrador da organização." },
          { status: 400 },
        );
      }
    }

    try {
      await prisma.user.delete({ where: { id: target.id } });
      return NextResponse.json({ ok: true });
    } catch (e) {
      if (isP2025(e)) {
        return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
      }
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2003"
      ) {
        return NextResponse.json(
          { message: "Não é possível excluir: existem registros vinculados a este usuário." },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao excluir usuário." }, { status: 500 });
  }
}
