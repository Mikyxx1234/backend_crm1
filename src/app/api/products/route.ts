import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return await runWithApiUserContext(authResult.user, async () => {
  const denied = await requirePermissionForUser(authResult.user, "product:view");
  if (denied) return denied;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const activeOnly = url.searchParams.get("active") !== "false";
  const typeFilter = url.searchParams.get("type")?.toUpperCase();
  const catalogId = url.searchParams.get("catalogId")?.trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("perPage")) || 50));

  const where: Record<string, unknown> = {};
  if (activeOnly) where.isActive = true;
  if (typeFilter === "PRODUCT" || typeFilter === "SERVICE") where.type = typeFilter;
  if (catalogId) where.catalogId = catalogId;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.product.count({ where }),
  ]);

  return NextResponse.json({ products, total, page, perPage });
  });
}

export async function POST(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return await runWithApiUserContext(authResult.user, async () => {
  const denied = await requirePermissionForUser(authResult.user, "product:create");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
  }

  const rawType = typeof body.type === "string" ? body.type.toUpperCase() : "PRODUCT";
  const type = rawType === "SERVICE" ? "SERVICE" : "PRODUCT";

  const trackStock = type === "PRODUCT" && body.trackStock === true;

  // catalogId opcional — valida pertença à org antes de vincular.
  let catalogId: string | null = null;
  if (typeof body.catalogId === "string" && body.catalogId.trim()) {
    const catalog = await prisma.catalog.findUnique({
      where: { id: body.catalogId.trim() },
      select: { id: true },
    });
    if (!catalog) {
      return NextResponse.json({ message: "Catálogo não encontrado." }, { status: 400 });
    }
    catalogId = catalog.id;
  }

  const product = await prisma.product.create({
    data: withOrgFromCtx({
      name,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      sku: typeof body.sku === "string" && body.sku.trim() ? body.sku.trim() : null,
      price: Number(body.price) || 0,
      unit: type === "SERVICE" ? "serviço" : (typeof body.unit === "string" && body.unit.trim() ? body.unit.trim() : "un"),
      type,
      catalogId,
      isActive: body.isActive !== false,
      trackStock,
      stock: trackStock ? Math.max(0, Number(body.stock) || 0) : 0,
    }),
  });

  return NextResponse.json({ product }, { status: 201 });
  });
}
