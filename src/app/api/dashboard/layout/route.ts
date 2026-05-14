import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { getLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = getLogger("api/dashboard/layout");

/**
 * Schema do payload de layout. Mantém validação solta pra permitir evoluir
 * o catálogo de widgets sem migration — widgets desconhecidos no backend
 * são aceitos (o client faz o filtro final). Apenas garante tipos básicos
 * e limita tamanhos pra evitar abuso (payload máximo ~16KB serializado).
 */
const gridItemSchema = z.object({
  i: z.string().min(1).max(64),
  x: z.number().int().min(0).max(50),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(50),
  minW: z.number().int().min(1).max(12).optional(),
  minH: z.number().int().min(1).max(50).optional(),
  maxW: z.number().int().min(1).max(12).optional(),
  maxH: z.number().int().min(1).max(50).optional(),
});

const payloadSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  preset: z
    .enum(["default", "comercial", "atendimento", "equipe", "monitor", "custom"])
    .optional(),
  visibleWidgets: z.array(z.string().min(1).max(64)).max(50),
  layout: z.record(z.string().min(1).max(64), gridItemSchema),
  /** Flags extras do layout (tema, densidade, etc.). */
  meta: z.record(z.string(), z.unknown()).optional(),
});

type LayoutData = z.infer<typeof payloadSchema>;

const DEFAULT_NAME = "Padrão";

/**
 * GET /api/dashboard/layout
 * Retorna o layout default do usuário. Sem registro, devolve 200 com
 * `{ layout: null }` — o client então usa o preset "default".
 */
export async function GET() {
  return withOrgContext(async (session) => {
    const userId = session.user.id;

    const record = await prisma.userDashboardLayout.findFirst({
      where: { userId, isDefault: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!record) {
      return NextResponse.json({ layout: null }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json(
      {
        id: record.id,
        name: record.name,
        preset: record.preset,
        data: record.data,
        updatedAt: record.updatedAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

/**
 * PUT /api/dashboard/layout
 * Cria ou atualiza (upsert) o layout default do usuário. O body traz
 * o shape completo — substituição, não patch. Usamos um único registro
 * por usuário (nome "Padrão" + isDefault true) pra simplificar o contrato
 * de persistência enquanto o recurso de múltiplos layouts nomeados não
 * existe na UI.
 */
export async function PUT(request: Request) {
  return withOrgContext(async (session) => {
    const userId = session.user.id;

    // Super-admin EduIT (sem organizationId) nao tem layout proprio; o
    // dashboard /admin tem outro fluxo. Evita explodir withOrgFromCtx
    // mais abaixo com mensagem nao acionavel.
    if (!session.user.organizationId) {
      return NextResponse.json(
        { message: "Super-admin não persiste layout de dashboard." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: "JSON inválido." },
        { status: 400 },
      );
    }

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Payload inválido.", issues: parsed.error.issues.slice(0, 5) },
        { status: 400 },
      );
    }

    const data: LayoutData = parsed.data;
    const name = data.name?.trim() || DEFAULT_NAME;

    // O Prisma valida `Json` contra `InputJsonValue`, que não aceita
    // `Record<string, unknown>` diretamente. Como já validamos o payload
    // com zod logo acima, o cast aqui é seguro — todo conteúdo é serializável.
    const payload = {
      visibleWidgets: data.visibleWidgets,
      layout: data.layout,
      meta: data.meta ?? {},
    } as unknown as Prisma.InputJsonValue;

    // Bug 27/abr/26 (P2025): o schema tem `@@unique([userId, name])` GLOBAL
    // (sem organizationId). Quando usavamos `upsert`, a extension injetava
    // organizationId no where compound; se ja existia uma row pro mesmo
    // (userId, name) em OUTRA org (ex.: super-admin alternando, ou usuario
    // movido de org), o findUnique interno do Prisma nao casava → INSERT
    // batia unique conflict → P2025. Trocamos por find-then-update-or-create
    // explicito, com chaveamento por `id` no update — resolve o caso
    // cross-org tomando posse da row para a org atual.
    try {
      // Cross-org lookup intencional: o unique `(userId, name)` eh GLOBAL,
      // entao um mesmo usuario pode ter, no maximo, UM registro por nome —
      // independente de org. Usamos prismaBase pra ignorar o filtro do
      // applyOrgScope, achar o registro existente (mesmo que tenha sido
      // criado em outra org), e tomar posse dele pra org atual.
      // Seguro porque `userId` veio da sessao autenticada — usuario so
      // pode mexer em layout proprio.
      const existing = await prismaBase.userDashboardLayout.findFirst({
        where: { userId, name },
        select: { id: true },
      });

      let record;
      if (existing) {
        record = await prismaBase.userDashboardLayout.update({
          where: { id: existing.id },
          data: {
            preset: data.preset ?? "custom",
            data: payload,
            isDefault: true,
            organizationId: session.user.organizationId,
          },
        });
      } else {
        record = await prisma.userDashboardLayout.create({
          data: withOrgFromCtx({
            userId,
            name,
            isDefault: true,
            preset: data.preset ?? "custom",
            data: payload,
          }),
        });
      }

      return NextResponse.json({
        ok: true,
        id: record.id,
        updatedAt: record.updatedAt.toISOString(),
      });
    } catch (err) {
      log.error("Falha ao salvar layout de dashboard:", err);
      return NextResponse.json(
        { message: "Não foi possível salvar o layout." },
        { status: 500 },
      );
    }
  });
}

/**
 * DELETE /api/dashboard/layout
 * Reseta o layout do usuário (volta ao preset default). Remove TODOS os
 * registros do usuário — barato e previsível. Uso pelo botão "Resetar".
 */
export async function DELETE() {
  return withOrgContext(async (session) => {
    const userId = session.user.id;
    await prisma.userDashboardLayout.deleteMany({ where: { userId } });
    return NextResponse.json({ ok: true });
  });
}
