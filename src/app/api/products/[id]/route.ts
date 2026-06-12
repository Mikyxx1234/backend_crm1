import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

type RouteContext = { params: Promise<{ id: string }> };

const PRODUCT_KINDS = new Set(["PHYSICAL", "SERVICE", "COURSE", "JOB_OPENING"]);
const PLAN_INTERVALS = new Set(["MONTHLY", "QUARTERLY", "YEARLY"]);
const COURSE_MODES = new Set(["EAD", "IN_PERSON", "HYBRID"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "product:view");
    if (denied) return denied;

    const { id } = await context.params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        customValues: {
          include: {
            customField: {
              select: { id: true, name: true, label: true, type: true, options: true },
            },
          },
        },
        offers: { include: { orgUnit: { select: { id: true, name: true } } } },
        inventoryPools: {
          select: { id: true, orgUnitId: true, consumeTrigger: true, allowNegative: true },
        },
        shipping: true,
        plans: { orderBy: { name: "asc" } },
        courseConfig: { include: { classes: { orderBy: { startsAt: "asc" } } } },
        stakeholders: {
          include: { contact: { select: { id: true, name: true, email: true, phone: true } } },
        },
        jobOpenings: { select: { id: true, title: true, status: true, poolId: true } },
      },
    });
    if (!product) {
      return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ product });
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "product:edit");
    if (denied) return denied;

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
    if (typeof body.price === "number" || typeof body.price === "string") {
      data.price = Number(body.price) || 0;
    }
    if (typeof body.unit === "string") data.unit = body.unit.trim() || "un";
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if (typeof body.type === "string") {
      const t = body.type.toUpperCase();
      if (t === "PRODUCT" || t === "SERVICE") data.type = t;
    }
    if (typeof body.kind === "string") {
      const k = body.kind.toUpperCase();
      if (PRODUCT_KINDS.has(k)) data.kind = k;
    }

    try {
      await prisma.product.update({ where: { id }, data });
    } catch {
      return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
    }

    // ── Blocos por kind (só quando enviados) ────────────────────────────
    const shipping = asRecord(body.shipping);
    if (shipping) {
      await prisma.productShipping.upsert({
        where: { productId: id },
        create: withOrgFromCtx({
          productId: id,
          weightGrams:
            shipping.weightGrams != null ? Number(shipping.weightGrams) || null : null,
          dimensions: (shipping.dimensions ?? null) as never,
          shippingPolicy: (shipping.shippingPolicy ?? null) as never,
        }),
        update: {
          weightGrams:
            shipping.weightGrams != null ? Number(shipping.weightGrams) || null : null,
          dimensions: (shipping.dimensions ?? null) as never,
          shippingPolicy: (shipping.shippingPolicy ?? null) as never,
        },
      });
    }

    if (Array.isArray(body.plans)) {
      await prisma.productPlan.deleteMany({ where: { productId: id } });
      for (const raw of body.plans) {
        const p = asRecord(raw);
        if (!p || typeof p.name !== "string" || !p.name.trim()) continue;
        const interval =
          typeof p.interval === "string" && PLAN_INTERVALS.has(p.interval.toUpperCase())
            ? p.interval.toUpperCase()
            : "MONTHLY";
        await prisma.productPlan.create({
          data: withOrgFromCtx({
            productId: id,
            name: p.name.trim(),
            interval: interval as never,
            amount: Number(p.amount) || 0,
            active: p.active !== false,
          }),
        });
      }
    }

    const course = asRecord(body.course);
    if (course) {
      const mode =
        typeof course.mode === "string" && COURSE_MODES.has(course.mode.toUpperCase())
          ? course.mode.toUpperCase()
          : "EAD";
      const postSalePipelineId =
        typeof course.postSalePipelineId === "string" && course.postSalePipelineId.trim()
          ? course.postSalePipelineId.trim()
          : null;
      const cfg = await prisma.courseConfig.upsert({
        where: { productId: id },
        create: withOrgFromCtx({
          productId: id,
          mode: mode as never,
          postSalePipelineId,
        }),
        update: { mode: mode as never, postSalePipelineId },
        select: { id: true },
      });
      if (Array.isArray(course.classes)) {
        await prisma.courseClass.deleteMany({ where: { courseConfigId: cfg.id } });
        for (const raw of course.classes) {
          const c = asRecord(raw);
          if (!c || typeof c.name !== "string" || !c.name.trim()) continue;
          await prisma.courseClass.create({
            data: withOrgFromCtx({
              courseConfigId: cfg.id,
              name: c.name.trim(),
              startsAt: c.startsAt ? new Date(String(c.startsAt)) : null,
              endsAt: c.endsAt ? new Date(String(c.endsAt)) : null,
              location: typeof c.location === "string" ? c.location.trim() || null : null,
              poolId: typeof c.poolId === "string" && c.poolId ? c.poolId : null,
            }),
          });
        }
      }
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        shipping: true,
        plans: true,
        courseConfig: { include: { classes: true } },
      },
    });
    return NextResponse.json({ product });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "product:delete");
    if (denied) return denied;

    const { id } = await context.params;
    try {
      await prisma.product.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
    }
  });
}
