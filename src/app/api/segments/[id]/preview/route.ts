import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getSegmentById, previewSegment, type SegmentFilters } from "@/services/segments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const { id } = await params;
    const segment = await getSegmentById(id);
    if (!segment) {
      return NextResponse.json({ message: "Segmento não encontrado." }, { status: 404 });
    }

    const preview = await previewSegment(segment.filters as unknown as SegmentFilters);
    return NextResponse.json(preview);
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao fazer preview." },
      { status: 500 },
    );
  }
}
