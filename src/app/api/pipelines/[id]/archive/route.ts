import { NextResponse } from "next/server";
import { compare } from "bcryptjs";

import { withOrgContext } from "@/lib/auth-helpers";
import { prismaBase } from "@/lib/prisma-base";
import { logAudit } from "@/lib/audit/log";
import { archivePipeline, getPipelineById } from "@/services/pipelines";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/pipelines/[id]/archive
 *
 * "Apagar pipeline" no CRM = soft-archive (`archivedAt`), NUNCA hard
 * delete — stages/deals permanecem no banco, o pipeline só some das
 * listagens. Restrito a ADMIN (ou super-admin) e exige reautenticação
 * por senha (mesmo padrão de `/api/auth/mfa/disable`), já que é uma
 * ação destrutiva do ponto de vista do usuário.
 *
 * Body: { password: string }
 */
export async function POST(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    if (session.user.role !== "ADMIN" && !session.user.isSuperAdmin) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

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
    const password =
      body && typeof body === "object" && typeof (body as { password?: unknown }).password === "string"
        ? (body as { password: string }).password
        : "";
    if (!password) {
      return NextResponse.json(
        { message: "Senha obrigatória para apagar o pipeline." },
        { status: 400 },
      );
    }

    // Escopo: `getPipelineById` usa o cliente Prisma tenant-scoped, então
    // um pipeline de outra organização já retorna null aqui (404).
    const existing = await getPipelineById(id);
    if (!existing) {
      return NextResponse.json({ message: "Pipeline não encontrado." }, { status: 404 });
    }

    const dbUser = await prismaBase.user.findUnique({
      where: { id: session.user.id },
      select: { hashedPassword: true },
    });
    if (!dbUser?.hashedPassword) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const passOk = await compare(password, dbUser.hashedPassword);
    if (!passOk) {
      return NextResponse.json({ message: "Senha incorreta." }, { status: 403 });
    }

    try {
      await archivePipeline(id);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "NOT_FOUND") {
          return NextResponse.json({ message: "Pipeline não encontrado." }, { status: 404 });
        }
        if (err.message === "ALREADY_ARCHIVED") {
          return NextResponse.json({ message: "Pipeline já foi apagado." }, { status: 409 });
        }
        if (err.message === "LAST_PIPELINE") {
          return NextResponse.json(
            { message: "Não é possível apagar o único pipeline da organização." },
            { status: 409 },
          );
        }
      }
      throw err;
    }

    await logAudit({
      entity: "pipeline",
      action: "delete",
      entityId: id,
      actorEmail: session.user.email ?? null,
      metadata: { softArchive: true, name: existing.name },
    });

    return NextResponse.json({ ok: true, archived: true });
  });
}
