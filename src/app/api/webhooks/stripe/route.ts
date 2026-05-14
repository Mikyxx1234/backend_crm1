/**
 * Webhook Stripe (PR 6.3).
 *
 * Recebe eventos relevantes pra manter `OrganizationSubscription` em sync.
 *
 * Eventos tratados:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_failed         → status PAST_DUE / UNPAID
 *   - invoice.payment_succeeded      → audit log + atualiza period
 *
 * Seguranca:
 *   1. Verifica assinatura HMAC com STRIPE_WEBHOOK_SECRET (rejeita 401 se invalida).
 *   2. Body raw — Next.js da `await req.text()` — nao parsear como json antes.
 *   3. Idempotencia: Stripe envia retries. Usamos o `event.id` como dedupe
 *      via cache Redis (TTL 7d). Sem cache → processa novamente (idempotente).
 *
 * NAO bloqueia long. Operacoes pesadas seriam delegadas a worker; aqui
 * fazemos updates simples no DB + audit log.
 */
import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { getLogger } from "@/lib/logger";

const logger = getLogger("stripe.webhook");
import { logAudit } from "@/lib/audit/log";
import { getStripeAdapter } from "@/lib/billing/stripe";
import { cache } from "@/lib/cache";

export const runtime = "nodejs"; // webhooks precisam de node runtime
export const dynamic = "force-dynamic";

const DEDUPE_TTL_SEC = 7 * 24 * 60 * 60;

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = await getStripeAdapter();
  if (!stripe.enabled) {
    logger.warn("[webhooks/stripe] recebido mas stripe desabilitado — ignorando");
    return NextResponse.json({ ok: true, note: "stripe disabled" });
  }

  let event: { id?: string; type: string; data: { object: unknown } };
  try {
    event = stripe.verifyWebhook(rawBody, signature) as typeof event;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[webhooks/stripe] assinatura invalida",
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Idempotencia por event.id
  if (event.id) {
    const dedupeKey = `stripe:event:${event.id}`;
    const seen = await cache.get<boolean>(dedupeKey);
    if (seen) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    await cache.set(dedupeKey, true, DEDUPE_TTL_SEC);
  }

  try {
    await dispatch(event);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), type: event.type },
      "[webhooks/stripe] erro ao processar",
    );
    // Stripe re-tenta em 5xx. 4xx = "para de tentar".
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

async function dispatch(event: { type: string; data: { object: unknown } }) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpdate(event.data.object);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      break;
    case "invoice.payment_failed":
      await handlePaymentFailed(event.data.object);
      break;
    case "invoice.payment_succeeded":
      await handlePaymentSucceeded(event.data.object);
      break;
    default:
      logger.debug({ type: event.type }, "[webhooks/stripe] tipo nao tratado");
  }
}

async function handleSubscriptionUpdate(payload: unknown) {
  const sub = payload as {
    id: string;
    status: string;
    customer: string;
    current_period_start: number;
    current_period_end: number;
    cancel_at_period_end: boolean;
    metadata?: { organization_id?: string; plan_key?: string };
  };

  const organizationId = sub.metadata?.organization_id;
  if (!organizationId) {
    logger.warn(
      { subId: sub.id },
      "[webhooks/stripe] subscription sem metadata.organization_id — ignorando",
    );
    return;
  }

  const planKey = sub.metadata?.plan_key ?? "free";
  const status = mapStripeStatus(sub.status);

  await prismaBase.organizationSubscription.upsert({
    where: { organizationId },
    update: {
      planKey,
      status,
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
    create: {
      organizationId,
      planKey,
      status,
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });

  await logAudit({
    organizationId,
    entity: "organization",
    entityId: organizationId,
    action: "subscription_updated",
    metadata: { planKey, status: sub.status, stripeSubId: sub.id },
  });
}

async function handleSubscriptionDeleted(payload: unknown) {
  const sub = payload as {
    id: string;
    metadata?: { organization_id?: string };
  };
  const organizationId = sub.metadata?.organization_id;
  if (!organizationId) return;

  await prismaBase.organizationSubscription.update({
    where: { organizationId },
    data: { status: "CANCELED", planKey: "free" },
  });
  await logAudit({
    organizationId,
    entity: "organization",
    entityId: organizationId,
    action: "subscription_canceled",
    metadata: { stripeSubId: sub.id },
  });
}

async function handlePaymentFailed(payload: unknown) {
  const inv = payload as {
    subscription?: string;
    customer?: string;
    attempt_count?: number;
  };
  if (!inv.subscription) return;
  const sub = await prismaBase.organizationSubscription.findUnique({
    where: { stripeSubscriptionId: inv.subscription },
  });
  if (!sub) return;
  const newStatus = (inv.attempt_count ?? 0) >= 3 ? "UNPAID" : "PAST_DUE";
  await prismaBase.organizationSubscription.update({
    where: { id: sub.id },
    data: { status: newStatus },
  });
  await logAudit({
    organizationId: sub.organizationId,
    entity: "organization",
    entityId: sub.organizationId,
    action: "payment_failed",
    metadata: {
      attemptCount: inv.attempt_count ?? 0,
      newStatus,
      stripeSubId: inv.subscription,
    },
  });
}

async function handlePaymentSucceeded(payload: unknown) {
  const inv = payload as {
    subscription?: string;
    period_end?: number;
  };
  if (!inv.subscription) return;
  const sub = await prismaBase.organizationSubscription.findUnique({
    where: { stripeSubscriptionId: inv.subscription },
  });
  if (!sub) return;
  await prismaBase.organizationSubscription.update({
    where: { id: sub.id },
    data: { status: "ACTIVE" },
  });
  await logAudit({
    organizationId: sub.organizationId,
    entity: "organization",
    entityId: sub.organizationId,
    action: "payment_succeeded",
    metadata: { stripeSubId: inv.subscription },
  });
}

function mapStripeStatus(s: string): "ACTIVE" | "TRIALING" | "PAST_DUE" | "UNPAID" | "CANCELED" {
  switch (s) {
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "UNPAID";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    case "active":
    case "incomplete":
    default:
      return "ACTIVE";
  }
}
