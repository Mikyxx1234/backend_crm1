import { NextResponse } from "next/server";

import { checkRateLimit, setRateLimitHeaders } from "@/lib/rate-limiter";
import { signupOrganizationWithAdmin } from "@/services/onboarding";

/**
 * Signup publico self-service: cria Organization + User(ADMIN) em uma
 * transacao unica. Substitui o fluxo antigo de convite-por-admin que
 * exigia super-admin da EduIT gerar um link manualmente.
 *
 * Nao requer autenticacao. Captcha fica pro proximo ciclo.
 *
 * Rate limit (in-memory, por processo):
 *   - 3 tentativas por IP em 10min   — barra robôs simples
 *   - 3 tentativas por email em 1h   — evita spam de tentativas com email valido
 *   - 5 tentativas por slug em 1h    — evita squatting agressivo de slug
 *
 * Em prod com 2+ replicas, o limite efetivo e N*limit; aceitavel pra signup.
 * Pra hardening real (Upstash Redis), ver docs/migration-prod-plan.md.
 *
 * Resposta 201 traz o email e o slug criados pra UI chamar
 * signIn("credentials") client-side na sequencia.
 */

const SIGNUP_IP_LIMIT = 3;
const SIGNUP_IP_WINDOW_MS = 10 * 60_000;
const SIGNUP_EMAIL_LIMIT = 3;
const SIGNUP_EMAIL_WINDOW_MS = 60 * 60_000;
const SIGNUP_SLUG_LIMIT = 5;
const SIGNUP_SLUG_WINDOW_MS = 60 * 60_000;

function getClientIp(request: Request): string {
  // Em prod atras de proxy, esses headers chegam preenchidos pelo nginx/EasyPanel.
  // Local sem proxy, caem em "unknown" e o limite ainda funciona (compartilhado).
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const ipRl = checkRateLimit(
    `signup:ip:${ip}`,
    SIGNUP_IP_LIMIT,
    SIGNUP_IP_WINDOW_MS,
  );
  if (!ipRl.allowed) {
    const res = NextResponse.json(
      {
        message:
          "Muitas tentativas de cadastro deste IP. Tente novamente em alguns minutos.",
      },
      { status: 429 },
    );
    setRateLimitHeaders(res.headers, ipRl);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const adminEmail = String(b.adminEmail ?? "").trim().toLowerCase();
  const slug = String(b.slug ?? "").trim().toLowerCase();

  if (adminEmail) {
    const emailRl = checkRateLimit(
      `signup:email:${adminEmail}`,
      SIGNUP_EMAIL_LIMIT,
      SIGNUP_EMAIL_WINDOW_MS,
    );
    if (!emailRl.allowed) {
      const res = NextResponse.json(
        {
          message:
            "Muitas tentativas de cadastro com este email. Tente novamente mais tarde.",
        },
        { status: 429 },
      );
      setRateLimitHeaders(res.headers, emailRl);
      return res;
    }
  }

  if (slug) {
    const slugRl = checkRateLimit(
      `signup:slug:${slug}`,
      SIGNUP_SLUG_LIMIT,
      SIGNUP_SLUG_WINDOW_MS,
    );
    if (!slugRl.allowed) {
      const res = NextResponse.json(
        {
          message:
            "Muitas tentativas com este identificador. Escolha outro ou tente mais tarde.",
        },
        { status: 429 },
      );
      setRateLimitHeaders(res.headers, slugRl);
      return res;
    }
  }

  try {
    const result = await signupOrganizationWithAdmin({
      organizationName: String(b.organizationName ?? ""),
      slug,
      adminName: String(b.adminName ?? ""),
      adminEmail,
      password: String(b.password ?? ""),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao criar conta.";
    return NextResponse.json({ message: msg }, { status: 400 });
  }
}
