import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import type { AppUserRole } from "@/lib/auth-types";
import {
  BOTTOM_NAV_MAX,
  DEFAULT_BOTTOM_NAV,
  DEFAULT_ENABLED,
  type MobileLayoutConfigDto,
  sanitizeModuleIds,
  serializeModuleIds,
} from "@/lib/mobile-layout";
import { prisma } from "@/lib/prisma";

const SINGLETON_ID = "default";

/**
 * GET /api/mobile-layout
 * Lê a configuração global. Se não existir ainda, retorna defaults
 * (sem criar a row — só persistimos no primeiro PUT). Resposta
 * sempre 200 com o DTO completo, simplificando o consumo no front.
 *
 * Autenticado mas sem restrição de role: o app mobile precisa ler
 * pra renderizar a navegação, qualquer operador autenticado pode.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const row = await prisma.mobileLayoutConfig.findUnique({
    where: { id: SINGLETON_ID },
  });

  const dto: MobileLayoutConfigDto = row
    ? {
        bottomNav: sanitizeModuleIds(row.bottomNavModuleIds, {
          ensureRequired: true,
          maxItems: BOTTOM_NAV_MAX,
        }),
        enabled: sanitizeModuleIds(row.enabledModuleIds, {
          ensureRequired: true,
        }),
        startRoute: row.startRoute,
        brandColor: row.brandColor,
        version: row.version,
      }
    : {
        bottomNav: DEFAULT_BOTTOM_NAV,
        enabled: DEFAULT_ENABLED,
        startRoute: "/inbox",
        brandColor: null,
        version: 0,
      };

  return NextResponse.json(dto);
}

/**
 * PUT /api/mobile-layout
 * Sobrescreve a configuração global. Apenas ADMIN.
 * Valida e sanitiza tudo no servidor (não confia no cliente).
 */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const role = (session.user as { role?: AppUserRole }).role;
  if (role !== "ADMIN") {
    return NextResponse.json(
      { error: "forbidden", message: "Apenas administradores podem editar o layout do app." },
      { status: 403 },
    );
  }

  let body: {
    bottomNav?: string[];
    enabled?: string[];
    startRoute?: string;
    brandColor?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Sanitização: enabled DEVE conter required (Inbox); bottomNav é
  // subset de enabled (não faz sentido habilitar item no nav que
  // está desativado globalmente).
  const enabled = sanitizeModuleIds(body.enabled, { ensureRequired: true });
  const bottomNav = sanitizeModuleIds(body.bottomNav, {
    ensureRequired: true,
    maxItems: BOTTOM_NAV_MAX,
  }).filter((id) => enabled.includes(id));

  // bottomNav após filtro pode ter perdido o required — re-injeta.
  if (!bottomNav.includes("inbox")) bottomNav.unshift("inbox");

  const startRoute = (body.startRoute ?? "/inbox").trim() || "/inbox";
  const brandColor =
    typeof body.brandColor === "string" && /^#[0-9a-fA-F]{6}$/.test(body.brandColor)
      ? body.brandColor
      : body.brandColor === null
        ? null
        : undefined; // ignora valor inválido

  const updated = await prisma.mobileLayoutConfig.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      bottomNavModuleIds: serializeModuleIds(bottomNav),
      enabledModuleIds: serializeModuleIds(enabled),
      startRoute,
      brandColor: brandColor ?? null,
      version: 1,
      updatedBy: session.user.id ?? null,
    },
    update: {
      bottomNavModuleIds: serializeModuleIds(bottomNav),
      enabledModuleIds: serializeModuleIds(enabled),
      startRoute,
      ...(brandColor !== undefined ? { brandColor } : {}),
      version: { increment: 1 },
      updatedBy: session.user.id ?? null,
    },
  });

  const dto: MobileLayoutConfigDto = {
    bottomNav,
    enabled,
    startRoute: updated.startRoute,
    brandColor: updated.brandColor,
    version: updated.version,
  };

  return NextResponse.json(dto);
}
