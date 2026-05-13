import { NextResponse } from "next/server";

import { requireAdmin, requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

/**
 * `system_settings` guarda configurações sensíveis (ex.: tokens de
 * integração, flags de roteamento, segredos de provedores externos).
 * Antes qualquer usuário autenticado podia ler e gravar — agora:
 *  - GET: ADMIN/MANAGER (operadores comuns não veem chaves de API).
 *  - PUT: ADMIN apenas (gravar é estritamente operação de dono).
 */

export async function GET(request: Request) {
  try {
    // Apenas operadores autorizados (admin/manager) leem o painel.
    // Membros normais não precisam ver chaves de integração.
    const r = await requireAuth();
    if (!r.ok) return r.response;
    const role = r.session.user.role;
    if (role !== "ADMIN" && role !== "MANAGER") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key");

    if (key) {
      const setting = await prisma.systemSetting.findUnique({ where: { key } });
      return NextResponse.json({ key, value: setting?.value ?? null });
    }

    const settings = await prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    return NextResponse.json(map);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao buscar configuração." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const r = await requireAdmin();
    if (!r.ok) return r.response;

    const body = (await request.json()) as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const value = typeof body.value === "string" ? body.value : "";

    if (!key) return NextResponse.json({ message: "key é obrigatório." }, { status: 400 });

    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return NextResponse.json(setting);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao salvar configuração." }, { status: 500 });
  }
}
