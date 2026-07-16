import { NextResponse } from "next/server";

import { getClientIp, withRateLimit } from "@/lib/rate-limit";
import { signupOrganizationWithAdmin } from "@/services/onboarding";

/**
 * Signup publico self-service: cria Organization + User(ADMIN) em uma
 * transacao unica.
 *
 * Rate limit distribuido (Redis via `withRateLimit` perfil `auth.public`),
 * substituindo o antigo limitador in-memory por processo que era
 * bypassavel escalando replicas ou spoofando `X-Forwarded-For`. IP e
 * extraido respeitando `TRUSTED_PROXY_HOPS`.
 *
 * Mensagens de erro genericas para "conta ja existe" e "slug em uso"
 * evitam enumeracao (era possivel testar se um email/slug ja estava
 * cadastrado antes de completar o signup).
 */

// Marca de conflito unico de identidade — o servico levanta mensagens
// diferentes ("Ja existe uma conta com este email", "Slug ja em uso",
// "Slug ou email ja em uso"). Todas viram uma resposta unica no cliente.
const IDENTITY_CONFLICT_MSGS = new Set<string>([
  "Já existe uma conta com este email.",
  "Slug já em uso por outra organização.",
  "Slug ou email já em uso.",
]);

const GENERIC_CONFLICT_MSG =
  "Não foi possível criar a conta com estes dados. Verifique as informações ou entre em contato com o suporte.";

export async function POST(request: Request) {
  const ip = getClientIp(request);

  const rl = await withRateLimit({
    route: "auth.signup",
    profile: "auth.public",
    scope: "ip",
    id: ip,
  });
  if (!rl.ok) return rl.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "JSON inválido." },
      { status: 400, headers: rl.headers },
    );
  }
  const b = body as Record<string, unknown>;

  const adminEmail = String(b.adminEmail ?? "").trim().toLowerCase();
  const slug = String(b.slug ?? "").trim().toLowerCase();

  try {
    const result = await signupOrganizationWithAdmin({
      organizationName: String(b.organizationName ?? ""),
      slug,
      adminName: String(b.adminName ?? ""),
      adminEmail,
      password: String(b.password ?? ""),
    });
    return NextResponse.json(result, { status: 201, headers: rl.headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao criar conta.";
    // Uniformiza mensagens que vazam existencia de email/slug para
    // evitar enumeracao. Validacoes puras (nome curto, email invalido,
    // senha curta) continuam explicitas — sao input do proprio usuario.
    const safeMsg = IDENTITY_CONFLICT_MSGS.has(msg) ? GENERIC_CONFLICT_MSG : msg;
    return NextResponse.json(
      { message: safeMsg },
      { status: 400, headers: rl.headers },
    );
  }
}
