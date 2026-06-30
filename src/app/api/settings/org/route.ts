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

import { withOrgContext } from "@/lib/auth-helpers";
import {
  deleteOrgSetting,
  getOrgSetting,
  getOrgSettingsByPrefix,
  setOrgSetting,
} from "@/lib/org-settings";

// Bug 24/jun/26: usávamos `requireAuth` / `requireAdmin` direto. Os helpers
// validam role mas NÃO populam o AsyncLocalStorage do `RequestContext`. Como
// `setOrgSetting`/`getOrgSetting` chamam `getOrgIdOrThrow()` (que lê do ALS),
// qualquer escrita disparava `Error: getOrgIdOrThrow: organization context
// ausente`. Toggle de "Motivo obrigatório" e qualquer outra setting via UI
// quebravam em 500. Migrado para `withOrgContext`, que combina `requireAuth`
// + `runWithContext`. Checagem de role passa a ser inline (admin pra escrita,
// admin/manager pra leitura) — mesmo padrão de `/api/deals/bulk` etc.

export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    const role = session.user.role;
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
  });
}

export async function PUT(request: Request) {
  return withOrgContext(async (session) => {
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

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
  });
}

export async function DELETE(request: Request) {
  return withOrgContext(async (session) => {
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

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
  });
}
