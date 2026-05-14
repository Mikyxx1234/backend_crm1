import { NextResponse } from "next/server";

/**
 * Endpoint publico de registro foi desativado no modelo multi-tenant.
 * Substituido por:
 *   - POST /api/admin/organizations          -> cria Organization + convite admin
 *   - POST /api/onboarding/user              -> consome convite admin e cria user
 *   - POST /api/invites/accept               -> consome convite de membro e cria user
 *
 * Mantido como 410 Gone para que integracoes antigas (se houver) recebam
 * uma resposta explicita em vez de 404 ambiguo.
 */
export async function POST() {
  return NextResponse.json(
    {
      message:
        "Cadastro publico desativado. Entre em contato com seu administrador para receber um convite.",
    },
    { status: 410 },
  );
}
