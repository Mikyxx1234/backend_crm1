import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { previewSegment, type SegmentFilters } from "@/services/segments";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const body = (await request.json()) as { filters?: SegmentFilters };
    const filters = body.filters ?? {};
    const preview = await previewSegment(filters);
    return NextResponse.json(preview);
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao fazer preview." },
      { status: 500 },
    );
  }
}
