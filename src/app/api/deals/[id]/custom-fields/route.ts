import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getDealCustomFieldValues,
  upsertDealCustomFieldValues,
} from "@/services/custom-fields";
import { createDealEvent, getDealById } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;
    const existing = await getDealById(id);
    if (!existing) return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    const values = await getDealCustomFieldValues(existing.id);
    return NextResponse.json(values);
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;
    const existing = await getDealById(id);
    if (!existing) return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    const dealId = existing.id;
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
    const oldValues = await getDealCustomFieldValues(dealId);
    await upsertDealCustomFieldValues(dealId, cleaned);
    const updated = await getDealCustomFieldValues(dealId);

    const uid = (session.user as { id: string }).id;
    const fieldIds = cleaned.map((c) => c.fieldId);
    const fieldDefs = await prisma.customField.findMany({
      where: { id: { in: fieldIds } },
      select: { id: true, label: true },
    });
    const labelMap = new Map(fieldDefs.map((f) => [f.id, f.label]));
    const oldMap = new Map((oldValues as { fieldId: string; value: string }[]).map((v) => [v.fieldId, v.value]));

    for (const item of cleaned) {
      const prev = oldMap.get(item.fieldId) ?? "";
      if (prev !== item.value) {
        createDealEvent(dealId, uid, "CUSTOM_FIELD_UPDATED", {
          fieldLabel: labelMap.get(item.fieldId) ?? item.fieldId,
          from: prev,
          to: item.value,
        }).catch(() => {});
      }
    }

    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}
