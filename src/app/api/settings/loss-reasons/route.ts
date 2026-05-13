import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

    const reasons = await prisma.lossReason.findMany({
      where: { isActive: true },
      orderBy: { position: "asc" },
    });
    return NextResponse.json(reasons);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao listar motivos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

    const body = (await request.json()) as Record<string, unknown>;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ message: "Label é obrigatório." }, { status: 400 });

    const maxPos = await prisma.lossReason.aggregate({ _max: { position: true } });
    const position = (maxPos._max.position ?? -1) + 1;

    const reason = await prisma.lossReason.create({
      data: { label, position },
    });
    return NextResponse.json(reason, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao criar motivo." }, { status: 500 });
  }
}
