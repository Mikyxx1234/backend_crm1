import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function GET() {
  return withOrgContext(async () => {
    try {
      const reasons = await prisma.lossReason.findMany({
        where: { isActive: true },
        orderBy: { position: "asc" },
      });
      return NextResponse.json(reasons);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao listar motivos." }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withOrgContext(async () => {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!label) return NextResponse.json({ message: "Label é obrigatório." }, { status: 400 });

      const maxPos = await prisma.lossReason.aggregate({ _max: { position: true } });
      const position = (maxPos._max.position ?? -1) + 1;

      const reason = await prisma.lossReason.create({
        data: withOrgFromCtx({ label, position }),
      });
      return NextResponse.json(reason, { status: 201 });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao criar motivo." }, { status: 500 });
    }
  });
}
