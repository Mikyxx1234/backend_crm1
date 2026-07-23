import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth-helpers";
import { importMatriculados } from "@/services/academic-records";

const MAX_FILE_SIZE = 32 * 1024 * 1024;

/**
 * Upload do relatório de matriculados (Excel/CSV). Substitui todos os
 * registros acadêmicos da org. Somente ADMIN. Escopo: organização da sessão.
 */
export async function POST(request: Request) {
  const r = await requireAdmin();
  if (!r.ok) return r.response;
  const orgId = r.session.user.organizationId;
  if (!orgId) {
    return NextResponse.json(
      { message: "Selecione uma organização antes de subir dados." },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ message: "Erro ao processar upload." }, { status: 400 });
  }

  const raw = form.get("file");
  if (!raw || !(raw instanceof Blob)) {
    return NextResponse.json({ message: 'Envie o arquivo no campo "file".' }, { status: 400 });
  }
  const file = raw as Blob & { name?: string };
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { message: `Arquivo excede o limite de ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }
  const fileName = file.name ?? "matriculados.xlsx";
  const lower = fileName.toLowerCase();
  if (!/\.(xlsx|xls|ods|csv)$/.test(lower)) {
    return NextResponse.json(
      { message: "Formato não suportado. Envie .xlsx, .xls, .ods ou .csv." },
      { status: 415 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importMatriculados({
      organizationId: orgId,
      buffer,
      fileName,
      uploadedById: r.session.user.id,
    });
    return NextResponse.json({
      ok: true,
      totalRows: result.totalRows,
      skipped: result.skipped,
      fileName,
    });
  } catch (e) {
    console.error("[academic-records] upload error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro interno ao importar." },
      { status: 500 },
    );
  }
}
