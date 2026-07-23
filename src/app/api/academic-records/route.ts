import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { getImportHistory, getRecordCount } from "@/services/academic-records";

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
