import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import { createCompany, getCompanies } from "@/services/companies";

function parseIntParam(v: string | null, fallback: number) {
  if (v === null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? undefined;
    const page = parseIntParam(searchParams.get("page"), 1);
    const perPage = parseIntParam(searchParams.get("perPage"), 20);

    const result = await getCompanies({ search, page, perPage });
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao listar empresas." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

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

    const company = await createCompany({
      name: b.name.trim(),
      domain: b.domain === null ? null : typeof b.domain === "string" ? b.domain.trim() : undefined,
      industry:
        b.industry === null ? null : typeof b.industry === "string" ? b.industry.trim() : undefined,
      size: b.size === null ? null : typeof b.size === "string" ? b.size.trim() : undefined,
      phone: b.phone === null ? null : typeof b.phone === "string" ? b.phone.trim() : undefined,
      address:
        b.address === null ? null : typeof b.address === "string" ? b.address.trim() : undefined,
      notes: b.notes === null ? null : typeof b.notes === "string" ? b.notes.trim() : undefined,
    });

    return NextResponse.json(company, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao criar empresa." }, { status: 500 });
  }
}
