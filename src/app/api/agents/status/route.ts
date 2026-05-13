import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { type: "HUMAN" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      agentStatus: { select: { status: true, availableForVoiceCalls: true, updatedAt: true } },
      schedule: {
        select: {
          startTime: true,
          lunchStart: true,
          lunchEnd: true,
          endTime: true,
          timezone: true,
          weekdays: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}
