import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";

/**
 * Batch de custom fields de produtos.
 *
 * `GET /api/products/custom-fields?ids=a,b,c` → `{ [productId]: Value[] }`
 *
 * Evita o N+1 do painel de produtos do deal (uma request por produto na
 * rota `/api/products/[id]/custom-fields`, que segue disponível).
 * Mesmo shape de item da rota single, mesmo escopo (extension Prisma) e
 * mesma permissão (`product:view`).
 */
const MAX_IDS = 200;

export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(session.user, "product:view");
      if (denied) return denied;

      const raw = new URL(request.url).searchParams.get("ids") ?? "";
      const ids = Array.from(
        new Set(
          raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ).slice(0, MAX_IDS);

      if (ids.length === 0) return NextResponse.json({});

      // findMany é filtrado por organização pela extension do Prisma — ids de
      // outra org simplesmente não retornam.
      const products = await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const allowedIds = products.map((p) => p.id);

      const result: Record<string, Record<string, unknown>[]> = {};
      for (const id of allowedIds) result[id] = [];

      if (allowedIds.length === 0) return NextResponse.json(result);

      const values = await prisma.productCustomFieldValue.findMany({
        where: { productId: { in: allowedIds } },
        include: {
          customField: { select: { id: true, name: true, label: true, type: true, options: true } },
        },
      });

      for (const v of values) {
        (result[v.productId] ??= []).push({
          fieldId: v.customFieldId,
          name: v.customField.name,
          label: v.customField.label,
          type: v.customField.type,
          options: v.customField.options,
          value: v.value,
        });
      }

      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}
