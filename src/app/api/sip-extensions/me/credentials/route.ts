import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { getMyCredentials } from "@/services/sip-extensions";

/**
 * GET /api/sip-extensions/me/credentials
 *
 * Retorna as credenciais SIP DESCRIPTOGRAFADAS do ramal do usuário autenticado.
 *
 * SEGURANÇA:
 *  - Autorização = ser o dono (session.userId). Sem permission key adicional.
 *  - NUNCA logar o corpo da resposta.
 *  - Não registrar o valor de authPassword em nenhum log.
 *  - Apenas usuários com ramal próprio recebem dados; 404 caso contrário.
 */
export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    try {
      // Autorização: o caller SÓ pode ver as próprias credenciais.
      // A checagem é implícita: getMyCredentials usa session.userId.
      const credentials = await getMyCredentials(authResult.user.id);

      if (!credentials) {
        return NextResponse.json(
          { message: "Nenhum ramal SIP configurado para este usuário." },
          { status: 404 },
        );
      }

      // NUNCA logar credentials — contém authPassword em plaintext
      return NextResponse.json({ credentials });
    } catch (e) {
      // Log sem incluir os dados da resposta
      console.error("[sip-extensions/me/credentials] Erro ao obter credenciais:", (e as Error)?.message ?? e);
      return NextResponse.json(
        { message: "Erro ao obter credenciais." },
        { status: 500 },
      );
    }
  });
}
