import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  getContactCustomFieldValues,
  upsertContactCustomFieldValues,
} from "@/services/custom-fields";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id } = await ctx.params;
      const values = await getContactCustomFieldValues(id);
      return NextResponse.json(values);
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id } = await ctx.params;
      const body = (await request.json()) as Record<string, unknown>;
      const values = Array.isArray(body.values) ? body.values : [];
      const cleaned = values
        .filter(
          (v): v is { fieldId: string; value: string } =>
            typeof v === "object" &&
            v !== null &&
            typeof (v as Record<string, unknown>).fieldId === "string" &&
            typeof (v as Record<string, unknown>).value === "string"
        );
      await upsertContactCustomFieldValues(id, cleaned);
      const updated = await getContactCustomFieldValues(id);
      return NextResponse.json(updated);
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}
