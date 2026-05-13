import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;

    const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });

    const values = await prisma.productCustomFieldValue.findMany({
      where: { productId: id },
      include: { customField: { select: { id: true, name: true, label: true, type: true, options: true } } },
    });

    return NextResponse.json(
      values.map((v) => ({
        fieldId: v.customFieldId,
        name: v.customField.name,
        label: v.customField.label,
        type: v.customField.type,
        options: v.customField.options,
        value: v.value,
      })),
    );
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;

    const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const values = Array.isArray(body.values) ? body.values : [];
    const cleaned = values.filter(
      (v): v is { fieldId: string; value: string } =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as Record<string, unknown>).fieldId === "string" &&
        typeof (v as Record<string, unknown>).value === "string",
    );

    for (const item of cleaned) {
      if (item.value.trim()) {
        await prisma.productCustomFieldValue.upsert({
          where: { productId_customFieldId: { productId: id, customFieldId: item.fieldId } },
          update: { value: item.value },
          create: { productId: id, customFieldId: item.fieldId, value: item.value },
        });
      } else {
        await prisma.productCustomFieldValue.deleteMany({
          where: { productId: id, customFieldId: item.fieldId },
        });
      }
    }

    const updated = await prisma.productCustomFieldValue.findMany({
      where: { productId: id },
      include: { customField: { select: { id: true, name: true, label: true, type: true, options: true } } },
    });

    return NextResponse.json(
      updated.map((v) => ({
        fieldId: v.customFieldId,
        name: v.customField.name,
        label: v.customField.label,
        type: v.customField.type,
        options: v.customField.options,
        value: v.value,
      })),
    );
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}
