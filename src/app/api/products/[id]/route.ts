import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      customValues: {
        include: { customField: { select: { id: true, name: true, label: true, type: true, options: true } } },
      },
    },
  });
  if (!product) {
    return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ product });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.sku === "string") data.sku = body.sku.trim() || null;
  if (typeof body.price === "number" || typeof body.price === "string") data.price = Number(body.price) || 0;
  if (typeof body.unit === "string") data.unit = body.unit.trim() || "un";
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  if (typeof body.type === "string") {
    const t = body.type.toUpperCase();
    if (t === "PRODUCT" || t === "SERVICE") data.type = t;
  }

  try {
    const product = await prisma.product.update({ where: { id }, data });
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
  }
}
