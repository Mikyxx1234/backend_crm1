import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import { getLogger } from "@/lib/logger";
import {
  type UpdateContactInput,
  contactExists,
  deleteContact,
  getContactById,
  updateContact,
  isValidLifecycleStage,
  checkContactDeals,
} from "@/services/contacts";

const log = getLogger("api.contacts.[id]");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const contact = await getContactById(id);
    if (!contact) {
      const exists = await contactExists(id).catch(() => false);
      if (!exists) {
        log.debug(`GET: contato ${id} não existe no banco`);
        return NextResponse.json({ message: "Contato não encontrado." }, { status: 404 });
      }
      log.warn(`GET: contato ${id} existe mas getContactById retornou null (relações falharam)`);
      return NextResponse.json(
        { message: "Erro ao montar detalhes do contato." },
        { status: 500 },
      );
    }

    return NextResponse.json(contact);
  } catch (e) {
    log.error(`GET /api/contacts/${id} falhou:`, e);
    const errMsg =
      process.env.NODE_ENV !== "production" && e instanceof Error ? ` Detalhe: ${e.message}` : "";
    return NextResponse.json(
      { message: `Erro ao buscar contato.${errMsg}` },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

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

    if (b.name !== undefined && (typeof b.name !== "string" || b.name.trim().length < 1)) {
      return NextResponse.json({ message: "Nome inválido." }, { status: 400 });
    }

    if (b.email !== undefined && b.email !== null) {
      if (typeof b.email !== "string" || !EMAIL_RE.test(b.email.trim().toLowerCase())) {
        return NextResponse.json({ message: "E-mail inválido." }, { status: 400 });
      }
    }

    if (
      b.lifecycleStage !== undefined &&
      b.lifecycleStage !== null &&
      (typeof b.lifecycleStage !== "string" || !isValidLifecycleStage(b.lifecycleStage))
    ) {
      return NextResponse.json({ message: "Estágio do ciclo inválido." }, { status: 400 });
    }

    if (b.leadScore !== undefined && b.leadScore !== null) {
      if (typeof b.leadScore !== "number" || !Number.isFinite(b.leadScore)) {
        return NextResponse.json({ message: "leadScore inválido." }, { status: 400 });
      }
    }

    const exists = await contactExists(id);
    if (!exists) {
      return NextResponse.json({ message: "Contato não encontrado." }, { status: 404 });
    }

    const data: UpdateContactInput = {};

    if (b.name !== undefined) {
      data.name = typeof b.name === "string" ? b.name.trim() : "";
    }
    if (b.email !== undefined) {
      data.email = b.email === null ? null : typeof b.email === "string" ? b.email.trim().toLowerCase() : undefined;
    }
    if (b.phone !== undefined) {
      data.phone = b.phone === null ? null : typeof b.phone === "string" ? b.phone.trim() : undefined;
    }
    if (b.avatarUrl !== undefined) {
      data.avatarUrl =
        b.avatarUrl === null ? null : typeof b.avatarUrl === "string" ? b.avatarUrl.trim() : undefined;
    }
    if (b.leadScore !== undefined) {
      data.leadScore = typeof b.leadScore === "number" ? b.leadScore : undefined;
    }
    if (b.lifecycleStage !== undefined) {
      data.lifecycleStage =
        typeof b.lifecycleStage === "string" && isValidLifecycleStage(b.lifecycleStage)
          ? b.lifecycleStage
          : undefined;
    }
    if (b.source !== undefined) {
      data.source = b.source === null ? null : typeof b.source === "string" ? b.source.trim() : undefined;
    }
    if (b.companyId !== undefined) {
      data.companyId = b.companyId === null ? null : typeof b.companyId === "string" ? b.companyId : undefined;
    }
    if (b.assignedToId !== undefined) {
      data.assignedToId =
        b.assignedToId === null ? null : typeof b.assignedToId === "string" ? b.assignedToId : undefined;
    }

    const payload = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    ) as UpdateContactInput;

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
    }

    const contact = await updateContact(id, payload);

    return NextResponse.json(contact);
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e) {
      const code = (e as { code: string }).code;
      if (code === "P2025") {
        return NextResponse.json({ message: "Contato não encontrado." }, { status: 404 });
      }
      if (code === "P2002") {
        return NextResponse.json({ message: "Violação de unicidade." }, { status: 409 });
      }
      if (code === "P2003") {
        return NextResponse.json({ message: "Referência inválida." }, { status: 400 });
      }
    }
    return NextResponse.json({ message: "Erro ao atualizar contato." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const exists = await contactExists(id);
    if (!exists) {
      return NextResponse.json({ message: "Contato não encontrado." }, { status: 404 });
    }

    const { hasDeals, dealCount } = await checkContactDeals(id);
    if (hasDeals) {
      return NextResponse.json(
        { message: `Não é possível excluir: este contato possui ${dealCount} negócio${dealCount !== 1 ? "s" : ""} vinculado${dealCount !== 1 ? "s" : ""}. Remova ou transfira os negócios antes de excluir.` },
        { status: 409 },
      );
    }

    await deleteContact(id);
    log.info(`contato ${id} excluído com sucesso`);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    log.error(`falha ao excluir contato ${id}:`, e);

    if (typeof e === "object" && e !== null && "code" in e) {
      const code = (e as { code: string }).code;
      const meta = (e as { meta?: Record<string, unknown> }).meta ?? {};
      const detail = typeof meta.field_name === "string"
        ? ` (campo: ${meta.field_name})`
        : typeof meta.modelName === "string"
          ? ` (modelo: ${meta.modelName})`
          : "";

      if (code === "P2003") {
        return NextResponse.json(
          {
            message:
              `Não é possível excluir: existem registros vinculados${detail}. Remova-os primeiro ou contate o administrador.`,
          },
          { status: 409 },
        );
      }
      if (code === "P2025") {
        return NextResponse.json({ message: "Contato não encontrado." }, { status: 404 });
      }
    }

    const errMsg =
      process.env.NODE_ENV !== "production" && e instanceof Error
        ? ` Detalhe: ${e.message}`
        : "";
    return NextResponse.json(
      { message: `Erro ao excluir contato.${errMsg}` },
      { status: 500 },
    );
  }
}
