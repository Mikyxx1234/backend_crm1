/**
 * GET /api/capabilities
 *
 * Catálogo do conjunto FECHADO de capacidades disponíveis + o JSON Schema do
 * `config` de cada uma. Consumido pelo wizard de catálogo (frontend) para
 * montar as sub-perguntas dinamicamente — capacidade nova aparece no wizard
 * sem recodificar a tela.
 *
 * Registro estático (igual para toda org); exige apenas sessão autenticada.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { serializeCapabilities } from "@/lib/capabilities";

export async function GET() {
  return withOrgContext(async () => {
    return NextResponse.json({ capabilities: serializeCapabilities() });
  });
}
