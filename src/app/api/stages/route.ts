import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  const stages = await prisma.stage.findMany({
    select: { id: true, name: true, color: true, position: true, pipelineId: true },
    orderBy: { position: "asc" },
  });
  return NextResponse.json(stages);
}
