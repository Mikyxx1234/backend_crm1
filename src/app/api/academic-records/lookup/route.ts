import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { lookupStudent } from "@/services/academic-records";

/**
 * Consulta de teste: busca registros acadêmicos por telefone/email/cpf.
 * Ex.: /api/academic-records/lookup?phone=11987742444
 * Útil pra validar o import antes de habilitar a tool do agente.
 */
export async function GET(request: Request) {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const orgId = r.session.user.organizationId;
  if (!orgId) return NextResponse.json({ records: [] });

  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone");
  const email = searchParams.get("email");
  const cpf = searchParams.get("cpf");
  if (!phone && !email && !cpf) {
    return NextResponse.json(
      { message: "Informe phone, email ou cpf." },
      { status: 400 },
    );
  }

  const records = await lookupStudent(orgId, { phone, email, cpf });
  return NextResponse.json({ found: records.length, records });
}
