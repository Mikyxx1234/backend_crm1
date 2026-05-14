/**
 * Feature flags por org — gestao via super-admin (PR 5.4).
 *
 *   GET  /api/admin/organizations/[id]/feature-flags
 *        → { flags: { ai_agent_v2: true, ... }, defaults, descriptions }
 *
 *   PUT  /api/admin/organizations/[id]/feature-flags
 *        body: { key: FlagKey, enabled: boolean, notes?: string }
 *        → 204
 *
 *   DELETE /api/admin/organizations/[id]/feature-flags?key=...
 *        → 204 (remove override, volta ao default)
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import {
  FLAGS,
  type FlagKey,
  loadAllFlags,
  setFeatureFlag,
  clearFeatureFlag,
} from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit/log";

function isValidFlag(k: string): k is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAGS, k);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await requireSuperAdmin();
  if (!r.ok) return r.response;

  const { id } = await params;
  const flags = await loadAllFlags(id);
  const meta = Object.fromEntries(
    (Object.keys(FLAGS) as FlagKey[]).map((k) => [
      k,
      {
        description: FLAGS[k].description,
        defaultEnabled: FLAGS[k].defaultEnabled,
      },
    ]),
  );
  return NextResponse.json({ flags, meta });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await requireSuperAdmin();
  if (!r.ok) return r.response;

  const { id } = await params;
  const session = await auth();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Body invalido." }, { status: 400 });
  }
  const data = body as {
    key?: string;
    enabled?: boolean;
    notes?: string | null;
  };
  if (
    typeof data?.key !== "string" ||
    typeof data?.enabled !== "boolean" ||
    !isValidFlag(data.key)
  ) {
    return NextResponse.json(
      { message: "key + enabled obrigatorios. key invalido?" },
      { status: 400 },
    );
  }

  await setFeatureFlag({
    organizationId: id,
    key: data.key,
    enabled: data.enabled,
    setById: session?.user?.id ?? null,
    notes: data.notes ?? null,
  });

  await logAudit({
    entity: "organization",
    action: "update",
    entityId: id,
    actorEmail: session?.user?.email ?? null,
    organizationId: id,
    metadata: {
      field: "feature_flag",
      flag: data.key,
      enabled: data.enabled,
    },
  });

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await requireSuperAdmin();
  if (!r.ok) return r.response;

  const { id } = await params;
  const session = await auth();
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key || !isValidFlag(key)) {
    return NextResponse.json({ message: "key invalido." }, { status: 400 });
  }

  await clearFeatureFlag(id, key);

  await logAudit({
    entity: "organization",
    action: "update",
    entityId: id,
    actorEmail: session?.user?.email ?? null,
    organizationId: id,
    metadata: {
      field: "feature_flag",
      flag: key,
      enabled: null,
      reset: true,
    },
  });

  return new NextResponse(null, { status: 204 });
}
