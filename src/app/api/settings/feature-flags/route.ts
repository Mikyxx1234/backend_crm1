import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { FLAGS, loadAllFlags, setFeatureFlag, type FlagKey } from "@/lib/feature-flags";

/** Flags que o admin da org pode gerenciar (excluir flags só de super-admin). */
const ORG_MANAGEABLE_FLAGS = new Set<FlagKey>([
  "permissions_v2_enabled",
  "rbac_granular_scope_v1",
]);

export async function GET() {
  const r = await requireCan("settings:security");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const allFlags = await loadAllFlags(ctx.organizationId);

  // Expor apenas as flags gerenciáveis pela org, com metadados do catálogo
  const flags = Array.from(ORG_MANAGEABLE_FLAGS).map((key) => ({
    key,
    description: FLAGS[key].description,
    enabled: allFlags[key] ?? FLAGS[key].defaultEnabled,
    defaultEnabled: FLAGS[key].defaultEnabled,
  }));

  return NextResponse.json({ flags });
}

export async function POST(request: Request) {
  const r = await requireCan("settings:security");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const key = typeof b.key === "string" ? (b.key as FlagKey) : null;
  const enabled = typeof b.enabled === "boolean" ? b.enabled : null;

  if (!key || !ORG_MANAGEABLE_FLAGS.has(key)) {
    return NextResponse.json(
      { message: `Flag inválida. Flags permitidas: ${Array.from(ORG_MANAGEABLE_FLAGS).join(", ")}` },
      { status: 400 },
    );
  }

  if (enabled === null) {
    return NextResponse.json({ message: "enabled (boolean) é obrigatório." }, { status: 400 });
  }

  await setFeatureFlag({
    organizationId: ctx.organizationId,
    key,
    enabled,
    setById: ctx.userId,
  });

  return NextResponse.json({ key, enabled });
}
