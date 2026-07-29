import { NextResponse } from "next/server";

import { requireAdmin, requireAuth } from "@/lib/auth-helpers";
import {
  clearAcademicRecords,
  getImportHistory,
  getRecordCount,
} from "@/services/academic-records";

/**
 * Status dos dados acadêmicos da org: total de registros + histórico de
 * importações. Usado pela aba "Dados dos alunos" (Agentes de IA).
 */
export async function GET() {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const orgId = r.session.user.organizationId;
  if (!orgId) return NextResponse.json({ count: 0, history: [] });

  const [count, history] = await Promise.all([
    getRecordCount(orgId),
    getImportHistory(orgId, 20),
  ]);
  return NextResponse.json({ count, history });
}

/**
 * Limpa toda a base de dados acadêmicos da org (registros + histórico).
 * Somente ADMIN. Escopo: organização da sessão.
 */
export async function DELETE() {
  const r = await requireAdmin();
  if (!r.ok) return r.response;
  const orgId = r.session.user.organizationId;
  if (!orgId) {
    return NextResponse.json(
      { message: "Selecione uma organização." },
      { status: 400 },
    );
  }
  const { deleted } = await clearAcademicRecords(orgId);
  return NextResponse.json({ ok: true, deleted });
}
