import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import {
  getContactCustomFieldValues,
  upsertContactCustomFieldValues,
} from "@/services/custom-fields";

type Ctx = { params: Promise<{ id: string }> };

// Bug 27/mai/26: usava `withOrgContext`, que só lê cookie do NextAuth.
// Bearer tokens (n8n, integrações server-to-server) recebiam 401 mesmo
// com token válido. Migrado para o par `authenticateApiRequest` +
// `runWithApiUserContext` — mesmo padrão de `/api/contacts/route.ts`,
// aceita Bearer e sessão.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
      const { id } = await ctx.params;
      const values = await getContactCustomFieldValues(id);
      return NextResponse.json(values);
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
      const { id } = await ctx.params;
      const body = (await request.json()) as Record<string, unknown>;
      const values = Array.isArray(body.values) ? body.values : [];
      const cleaned = values.filter(
        (v): v is { fieldId: string; value: string } =>
          typeof v === "object" &&
          v !== null &&
          typeof (v as Record<string, unknown>).fieldId === "string" &&
          typeof (v as Record<string, unknown>).value === "string",
      );
      await upsertContactCustomFieldValues(id, cleaned);
      const updated = await getContactCustomFieldValues(id);
      return NextResponse.json(updated);
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro." },
      { status: 500 },
    );
  }
}
