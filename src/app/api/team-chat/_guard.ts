import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import type { PermissionKey } from "@/lib/authz";
import type { TeamChatViewer } from "@/services/team-chat";

export async function denyUnless(session: Session, key: PermissionKey) {
  return requirePermissionForUser(
    {
      id: session.user.id,
      role: session.user.role,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    },
    key,
  );
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

export function viewerOf(session: Session): TeamChatViewer {
  return {
    userId: session.user.id,
    organizationId: session.user.organizationId!,
  };
}
