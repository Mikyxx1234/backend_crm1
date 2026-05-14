import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import type { SectionConfig } from "@/lib/field-layout";
import { prisma } from "@/lib/prisma";

function isMissingFieldLayoutTable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021" &&
    String(error.meta?.table ?? "").includes("field_layout_configs")
  );
}

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;
  return runWithApiUserContext(authResult.user, async () => {
    const { searchParams } = new URL(request.url);
    const context = searchParams.get("context");
    const forUser = searchParams.get("forUser") === "true";
    const user = authResult.user as { id: string; organizationId: string };
    if (!context) return NextResponse.json({ admin: null, agent: null });

    try {
      const adminConfig = await prisma.fieldLayoutConfig.findFirst({
        where: { organizationId: user.organizationId, context, userId: null },
      });

      const agentConfig = forUser
        ? await prisma.fieldLayoutConfig.findFirst({
            where: { organizationId: user.organizationId, context, userId: user.id },
          })
        : null;

      return NextResponse.json({
        admin: adminConfig?.sections ?? null,
        agent: agentConfig?.sections ?? null,
      });
    } catch (error) {
      if (isMissingFieldLayoutTable(error)) {
        return NextResponse.json({ admin: null, agent: null });
      }
      throw error;
    }
  });
}

export async function PUT(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;
  return runWithApiUserContext(authResult.user, async () => {
    const user = authResult.user as { id: string; role: string; organizationId: string };
    const body = (await request.json()) as {
      context: string;
      sections: SectionConfig[];
      scope: "admin" | "agent";
    };
    const { context, sections, scope } = body;

    if (scope === "admin" && user.role !== "ADMIN" && user.role !== "MANAGER") {
      return NextResponse.json({ message: "Sem permissão" }, { status: 403 });
    }

    try {
      if (scope === "agent" && sections.length === 0) {
        await prisma.fieldLayoutConfig.deleteMany({
          where: { organizationId: user.organizationId, context, userId: user.id },
        });
        return NextResponse.json({ ok: true });
      }

      const userId = scope === "admin" ? null : user.id;
      const existing = await prisma.fieldLayoutConfig.findFirst({
        where: { organizationId: user.organizationId, context, userId },
        select: { id: true },
      });

      if (existing) {
        await prisma.fieldLayoutConfig.update({
          where: { id: existing.id },
          data: { sections: sections as object },
        });
      } else {
        await prisma.fieldLayoutConfig.create({
          data: {
            organizationId: user.organizationId,
            userId,
            context,
            sections: sections as object,
          },
        });
      }

      return NextResponse.json({ ok: true });
    } catch (error) {
      if (isMissingFieldLayoutTable(error)) {
        return NextResponse.json(
          { ok: false, message: "Layout indisponível até aplicar migration." },
          { status: 503 },
        );
      }
      throw error;
    }
  });
}
