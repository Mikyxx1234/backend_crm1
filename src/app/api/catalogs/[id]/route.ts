/**
 * GET    /api/catalogs/[id]   — detalhe do catálogo (capacidades + produtos).
 * PUT    /api/catalogs/[id]   — atualiza nome/descrição e SINCRONIZA capacidades.
 * DELETE /api/catalogs/[id]   — exclui catálogo (default não é excluível).
 *
 * O PUT recebe a lista completa de capacidades desejada e reconcilia (upsert dos
 * presentes, remoção dos ausentes). Cada `config` é validado pelo Zod da Fase 0.
 */
import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import {
  CapabilityConfigError,
  UnknownCapabilityError,
  validateCapabilityConfig,
} from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

type RouteContext = { params: Promise<{ id: string }> };

const OVERRIDE_POLICIES = new Set(["LOCKED", "DEFAULT", "OPEN"]);

type ValidatedCap = {
  key: string;
  mode: string;
  config: Record<string, unknown>;
  overridePolicy: "LOCKED" | "DEFAULT" | "OPEN";
  enabled: boolean;
};

function validateCapabilities(raw: unknown): ValidatedCap[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw NextResponse.json(
      { message: "`capabilities` deve ser uma lista." },
      { status: 400 },
    );
  }
  const out: ValidatedCap[] = [];
  for (const item of raw) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = typeof r.capabilityKey === "string" ? r.capabilityKey : "";
    const mode = typeof r.mode === "string" ? r.mode : "";
    const policyRaw =
      typeof r.overridePolicy === "string" ? r.overridePolicy.toUpperCase() : "DEFAULT";
    const overridePolicy = (OVERRIDE_POLICIES.has(policyRaw) ? policyRaw : "DEFAULT") as
      | "LOCKED"
      | "DEFAULT"
      | "OPEN";
    try {
      // Schema é discriminated union por `mode` — injeta o mode no config.
      const config = validateCapabilityConfig(key, {
        ...(r.config && typeof r.config === "object" ? r.config : {}),
        mode,
      });
      out.push({ key, mode, config, overridePolicy, enabled: r.enabled !== false });
    } catch (err) {
      if (err instanceof UnknownCapabilityError) {
        throw NextResponse.json(
          { message: `Capacidade desconhecida: ${key}` },
          { status: 400 },
        );
      }
      if (err instanceof CapabilityConfigError) {
        throw NextResponse.json(
          { message: `Config inválida para "${key}".`, errors: err.flatten() },
          { status: 400 },
        );
      }
      throw err;
    }
  }
  return out;
}

export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "catalog:view");
    if (denied) return denied;

    const { id } = await context.params;
    const catalog = await prisma.catalog.findUnique({
      where: { id },
      include: {
        capabilities: {
          select: {
            id: true,
            capabilityKey: true,
            mode: true,
            config: true,
            overridePolicy: true,
            enabled: true,
          },
        },
        products: { select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } },
      },
    });
    if (!catalog) {
      return NextResponse.json({ message: "Catálogo não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ catalog });
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    // Ligar/desligar capacidades exige a permission de edição de capacidades.
    const denied = await requirePermissionForUser(
      authResult.user,
      "catalog:edit_capabilities",
    );
    if (denied) return denied;

    const { id } = await context.params;
    const existing = await prisma.catalog.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ message: "Catálogo não encontrado." }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    let caps: ValidatedCap[] | null = null;
    if (body.capabilities !== undefined) {
      try {
        caps = validateCapabilities(body.capabilities);
      } catch (err) {
        if (err instanceof NextResponse) return err;
        throw err;
      }
    }

    const catalog = await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
      if (body.description !== undefined) {
        data.description =
          typeof body.description === "string" ? body.description.trim() || null : null;
      }
      if (Object.keys(data).length > 0) {
        await tx.catalog.update({ where: { id }, data });
      }

      // Reconcilia capacidades (se enviadas): remove ausentes, upsert presentes.
      if (caps) {
        const desiredKeys = new Set(caps.map((c) => c.key));
        await tx.catalogCapability.deleteMany({
          where: { catalogId: id, capabilityKey: { notIn: [...desiredKeys] } },
        });
        for (const c of caps) {
          await tx.catalogCapability.upsert({
            where: { catalogId_capabilityKey: { catalogId: id, capabilityKey: c.key } },
            update: {
              mode: c.mode,
              config: c.config,
              overridePolicy: c.overridePolicy,
              enabled: c.enabled,
            },
            create: withOrgFromCtx({
              catalogId: id,
              capabilityKey: c.key,
              mode: c.mode,
              config: c.config,
              overridePolicy: c.overridePolicy,
              enabled: c.enabled,
            }),
          });
        }
      }

      return tx.catalog.findUnique({
        where: { id },
        include: {
          capabilities: {
            select: {
              id: true,
              capabilityKey: true,
              mode: true,
              config: true,
              overridePolicy: true,
              enabled: true,
            },
          },
        },
      });
    });

    return NextResponse.json({ catalog });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "catalog:delete");
    if (denied) return denied;

    const { id } = await context.params;
    const catalog = await prisma.catalog.findUnique({
      where: { id },
      select: { id: true, isDefault: true },
    });
    if (!catalog) {
      return NextResponse.json({ message: "Catálogo não encontrado." }, { status: 404 });
    }
    if (catalog.isDefault) {
      return NextResponse.json(
        { message: "O catálogo padrão não pode ser excluído." },
        { status: 400 },
      );
    }

    // Produtos do catálogo voltam a ficar sem catálogo (FK SET NULL no schema).
    await prisma.catalog.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
