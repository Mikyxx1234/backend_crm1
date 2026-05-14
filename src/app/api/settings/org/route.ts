/**
 * Settings org-scoped — endpoint cliente da `OrganizationSetting`.
 *
 * Multi-tenancy v0: este endpoint substitui `/api/settings/system` para
 * qualquer chave per-tenant. O endpoint legado fica restrito a
 * super-admin EduIT (chaves verdadeiramente globais).
 *
 * Permissões:
 *  - GET: ADMIN ou MANAGER da org (operadores que precisam ler config).
 *  - PUT: ADMIN da org (escrita estritamente operação de dono).
 *  - DELETE: ADMIN da org.
 *
 * Tenant isolation: a leitura/escrita usa `prisma.organizationSetting`,
 * que está em SCOPED_MODELS (extension injeta organizationId
 * automaticamente). RLS na tabela `organization_settings` é a 2a camada.
 */
import { NextResponse } from "next/server";

import { requireAdmin, requireAuth } from "@/lib/auth-helpers";
import {
  deleteOrgSetting,
  getOrgSetting,
  getOrgSettingsByPrefix,
  setOrgSetting,
} from "@/lib/org-settings";

export async function GET(request: Request) {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const role = r.session.user.role;
  if (role !== "ADMIN" && role !== "MANAGER") {
    return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const prefix = url.searchParams.get("prefix");

  try {
    if (key) {
      const value = await getOrgSetting(key);
      return NextResponse.json({ key, value });
    }
    if (prefix) {
      const map = await getOrgSettingsByPrefix(prefix);
      return NextResponse.json(Object.fromEntries(map));
    }
    return NextResponse.json(
      { message: "Informe `?key=` ou `?prefix=`." },
      { status: 400 },
    );
  } catch (err) {
    console.error("[settings/org] GET falhou:", err);
    return NextResponse.json(
      { message: "Erro ao ler configuração." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const r = await requireAdmin();
  if (!r.ok) return r.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }
  const b = body as { key?: unknown; value?: unknown };
  const key = typeof b.key === "string" ? b.key.trim() : "";
  const value = typeof b.value === "string" ? b.value : "";
  if (!key) {
    return NextResponse.json({ message: "key é obrigatório." }, { status: 400 });
  }

  try {
    await setOrgSetting(key, value);
    return NextResponse.json({ key, value });
  } catch (err) {
    console.error("[settings/org] PUT falhou:", err);
    return NextResponse.json(
      { message: "Erro ao salvar configuração." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const r = await requireAdmin();
  if (!r.ok) return r.response;

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ message: "key é obrigatório." }, { status: 400 });
  }

  try {
    await deleteOrgSetting(key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[settings/org] DELETE falhou:", err);
    return NextResponse.json(
      { message: "Erro ao remover configuração." },
      { status: 500 },
    );
  }
}
