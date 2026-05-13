import { NextResponse } from "next/server";

import { getVapidPublicKey } from "@/lib/web-push";

/**
 * Endpoint publico — devolve a VAPID public key pro browser
 * registrar a subscription. NAO requer autenticacao (a chave eh
 * publica por design; e usada apenas pra criptografar payloads de
 * envio, nunca pra autorizar nada).
 *
 * Retornamos 503 quando push nao esta configurado (sem VAPID env)
 * pra que o cliente possa desabilitar a UI graciosamente.
 */
export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { error: "push_not_configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ publicKey });
}
