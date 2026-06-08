import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { PERMISSION_CATALOG } from "@/lib/authz/permissions";

export async function GET() {
  const r = await requireCan("settings:roles");
  if (!r.ok) return r.response;

  return NextResponse.json({ resources: PERMISSION_CATALOG });
}
