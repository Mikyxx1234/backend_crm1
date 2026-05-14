import { NextResponse } from "next/server";
import { requireAuth, userOrgFilter } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const r = await requireAuth();
  if (!r.ok) return r.response;

  const users = await prisma.user.findMany({
    where: { type: "HUMAN", ...userOrgFilter(r.session) },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      schedule: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}
