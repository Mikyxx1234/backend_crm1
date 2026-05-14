import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import {
  createContact,
  getContacts,
  isValidLifecycleStage,
} from "@/services/contacts";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseIntParam(v: string | null, fallback: number) {
  if (v === null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? undefined;
    const lifecycleStageRaw = searchParams.get("lifecycleStage");
    const lifecycleStage =
      lifecycleStageRaw && isValidLifecycleStage(lifecycleStageRaw) ? lifecycleStageRaw : undefined;
    const companyId = searchParams.get("companyId") ?? undefined;
    const tagIdsParam = searchParams.get("tagIds");
    const tagIds = tagIdsParam
      ? tagIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined;
    const page = parseIntParam(searchParams.get("page"), 1);
    const perPage = parseIntParam(searchParams.get("perPage"), 20);
    const sortByRaw = searchParams.get("sortBy");
    const sortOrderRaw = searchParams.get("sortOrder");
    const sortBy =
      sortByRaw === "name" ||
      sortByRaw === "email" ||
      sortByRaw === "createdAt" ||
      sortByRaw === "updatedAt" ||
      sortByRaw === "leadScore" ||
      sortByRaw === "lifecycleStage"
        ? sortByRaw
        : undefined;
    const sortOrder = sortOrderRaw === "asc" || sortOrderRaw === "desc" ? sortOrderRaw : undefined;

    const result = await getContacts({
      search,
      lifecycleStage,
      tagIds,
      companyId,
      page,
      perPage,
      sortBy,
      sortOrder,
    });

    return NextResponse.json(result);
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao listar contatos." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {

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

    if (typeof b.name !== "string" || b.name.trim().length < 1) {
      return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
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

    const contact = await createContact({
      name: b.name.trim(),
      email:
        b.email === null
          ? null
          : typeof b.email === "string"
            ? b.email.trim().toLowerCase()
            : undefined,
      phone:
        b.phone === null ? null : typeof b.phone === "string" ? b.phone.trim() : undefined,
      avatarUrl:
        b.avatarUrl === null
          ? null
          : typeof b.avatarUrl === "string"
            ? b.avatarUrl.trim()
            : undefined,
      leadScore: typeof b.leadScore === "number" ? b.leadScore : undefined,
      lifecycleStage:
        typeof b.lifecycleStage === "string" && isValidLifecycleStage(b.lifecycleStage)
          ? b.lifecycleStage
          : undefined,
      source:
        b.source === null ? null : typeof b.source === "string" ? b.source.trim() : undefined,
      companyId:
        b.companyId === null
          ? null
          : typeof b.companyId === "string"
            ? b.companyId
            : undefined,
      assignedToId:
        b.assignedToId === null
          ? null
          : typeof b.assignedToId === "string"
            ? b.assignedToId
            : undefined,
    });

    return NextResponse.json(contact, { status: 201 });
    });
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      return NextResponse.json(
        { message: "Violação de unicidade." },
        { status: 409 }
      );
    }
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2003") {
      return NextResponse.json(
        { message: "Referência inválida (empresa ou usuário não encontrado)." },
        { status: 400 }
      );
    }
    return NextResponse.json({ message: "Erro ao criar contato." }, { status: 500 });
  }
}
