/**
 * GET  /api/catalogs           — lista catálogos da org (com capacidades).
 * POST /api/catalogs           — cria catálogo + liga capacidades (config validada).
 *
 * Catálogo Universal por Capacidades (PRD §6). O wizard de catálogo consome
 * estas rotas. As capacidades vêm como `{ capabilityKey, config, enabled }[]`
 * e cada `config` é validado pelo Zod da Fase 0 antes de persistir.
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

const OVERRIDE_POLICIES = new Set(["LOCKED", "DEFAULT", "OPEN"]);

type CapabilityInput = {
  capabilityKey: string;
  mode: string;
  config?: unknown;
  overridePolicy: "LOCKED" | "DEFAULT" | "OPEN";
  enabled?: boolean;
};

type ValidatedCap = {
  key: string;
  mode: string;
  config: Record<string, unknown>;
  overridePolicy: "LOCKED" | "DEFAULT" | "OPEN";
  enabled: boolean;
};

/** Lê e valida o array de capacidades do body. Lança Response em erro. */
function parseCapabilities(raw: unknown): CapabilityInput[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw NextResponse.json(
      { message: "`capabilities` deve ser uma lista." },
      { status: 400 },
    );
  }
  return raw.map((item) => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = typeof r.capabilityKey === "string" ? r.capabilityKey : "";
    const mode = typeof r.mode === "string" ? r.mode : "";
    const policyRaw = typeof r.overridePolicy === "string" ? r.overridePolicy.toUpperCase() : "DEFAULT";
    const overridePolicy = (OVERRIDE_POLICIES.has(policyRaw) ? policyRaw : "DEFAULT") as
      | "LOCKED"
      | "DEFAULT"
      | "OPEN";
    return { capabilityKey: key, mode, config: r.config, overridePolicy, enabled: r.enabled !== false };
  });
}

/** Valida configs via registry; retorna lista normalizada ou Response de erro. */
function validateAll(caps: CapabilityInput[]): ValidatedCap[] {
  const out: ValidatedCap[] = [];
  for (const cap of caps) {
    try {
      // Schema é discriminated union por `mode` — injeta o mode no config.
      const config = validateCapabilityConfig(cap.capabilityKey, {
        ...(cap.config && typeof cap.config === "object" ? cap.config : {}),
        mode: cap.mode,
      });
      out.push({
        key: cap.capabilityKey,
        mode: cap.mode,
        config,
        overridePolicy: cap.overridePolicy,
        enabled: cap.enabled !== false,
      });
    } catch (err) {
      if (err instanceof UnknownCapabilityError) {
        throw NextResponse.json(
          { message: `Capacidade desconhecida: ${cap.capabilityKey}` },
          { status: 400 },
        );
      }
      if (err instanceof CapabilityConfigError) {
        throw NextResponse.json(
          {
            message: `Config inválida para "${cap.capabilityKey}".`,
            errors: err.flatten(),
          },
          { status: 400 },
        );
      }
      throw err;
    }
  }
  return out;
}

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "catalog:view");
    if (denied) return denied;

    const url = new URL(request.url);
    const includeTemplates = url.searchParams.get("templates") === "true";

    const catalogs = await prisma.catalog.findMany({
      where: includeTemplates ? {} : { isTemplate: false },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
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
        _count: { select: { products: true } },
      },
    });
    return NextResponse.json({ catalogs });
  });
}

export async function POST(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "catalog:create");
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

    let validated: ValidatedCap[];
    try {
      validated = validateAll(parseCapabilities(body.capabilities));
    } catch (err) {
      if (err instanceof NextResponse) return err;
      throw err;
    }

    const catalog = await prisma.catalog.create({
      data: withOrgFromCtx({
        name,
        description:
          typeof body.description === "string" ? body.description.trim() || null : null,
        templateKey:
          typeof body.templateKey === "string" ? body.templateKey.trim() || null : null,
        capabilities: {
          create: validated.map((c) =>
            withOrgFromCtx({
              capabilityKey: c.key,
              mode: c.mode,
              config: c.config,
              overridePolicy: c.overridePolicy,
              enabled: c.enabled,
            }),
          ),
        },
      }),
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
    return NextResponse.json({ catalog }, { status: 201 });
  });
}
