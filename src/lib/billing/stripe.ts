/**
 * Wrapper sobre o SDK do Stripe (PR 6.3).
 *
 * Por que abstracao em vez de chamar `Stripe` direto:
 *   1. Permite stub-ar em dev/CI (sem instalar o SDK em ambientes
 *      self-hosted que nao usam Stripe).
 *   2. Centraliza idempotency keys, retry e logging.
 *   3. Facilita troca futura de provider (Lemon Squeezy, Paddle, etc.).
 *
 * Modo de operacao:
 *   - `STRIPE_SECRET_KEY` ausente → modo stub (todas as chamadas
 *     viram no-ops + log). Ideal para self-hosted EduIT que nao
 *     factura, ou em desenvolvimento sem chave Stripe.
 *   - Presente → tenta dynamic-import do SDK. Se nao instalado,
 *     loga warning e cai pro stub. Para ativar de verdade:
 *     `npm install stripe`.
 */
import { getLogger } from "@/lib/logger";

const logger = getLogger("billing.stripe");

interface UsageRecordCreateInput {
  subscriptionItemId: string;
  /** Quantidade reportada (delta no periodo). */
  quantity: number;
  /** Unix seconds — quando o consumo aconteceu. */
  timestamp: number;
  /** Idempotency key — retry seguro. */
  idempotencyKey: string;
  /** "increment" (default) ou "set". */
  action?: "increment" | "set";
}

interface SubscriptionRetrieveResult {
  id: string;
  status: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  /** Mapa de meterKey → subscriptionItemId. Populado pelo caller via metadata. */
  meteredItems: Record<string, string>;
}

export interface StripeAdapter {
  enabled: boolean;
  reportUsage(input: UsageRecordCreateInput): Promise<void>;
  retrieveSubscription(id: string): Promise<SubscriptionRetrieveResult | null>;
  /** Verifica assinatura HMAC do webhook. Retorna evento parseado. */
  verifyWebhook(rawBody: string, signature: string): { type: string; data: unknown };
}

/* ───────────────────────────── Stub ────────────────────────────── */

const stub: StripeAdapter = {
  enabled: false,
  async reportUsage(input) {
    logger.debug(
      { meter: input.subscriptionItemId, quantity: input.quantity },
      "[billing/stripe] stub.reportUsage (no-op)",
    );
  },
  async retrieveSubscription() {
    return null;
  },
  verifyWebhook() {
    throw new Error(
      "[billing/stripe] webhook recebido mas STRIPE_SECRET_KEY nao configurado.",
    );
  },
};

/* ───────────────────────────── Real adapter ────────────────────── */

let cached: StripeAdapter | null = null;

/**
 * Retorna o adapter Stripe ativo. Se a env nao estiver setada ou o
 * SDK nao estiver instalado, devolve stub. Cache em memoria — re-chamar
 * e gratis.
 */
export async function getStripeAdapter(): Promise<StripeAdapter> {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    cached = stub;
    return stub;
  }

  let StripeCtor: unknown;
  try {
    // dynamic import — nao quebra build se SDK nao instalado.
    //
    // /* webpackIgnore: true */ instrui o webpack a NAO tentar resolver
    // este modulo no build-time. Sem isso, o webpack faz static analysis,
    // tenta achar `stripe` no node_modules, falha com warning, e gera um
    // placeholder vazio no chunk que quebra com `ReferenceError: Cannot
    // access 'o' before initialization` no `next build` -> Collecting
    // page data. O `webpackIgnore` deixa a string como-esta e o Node
    // resolve em runtime (ou cai no .catch se nao houver pacote).
    //
    // O `@ts-expect-error` cobre o caso (esperado no setup self-host)
    // em que o pacote `stripe` nao foi adicionado ao package.json.
    // @ts-expect-error optional dependency
    const mod = await import(/* webpackIgnore: true */ "stripe").catch(
      () => null,
    );
    if (!mod) {
      logger.warn(
        "[billing/stripe] STRIPE_SECRET_KEY setado mas pacote `stripe` nao instalado. Rodando em stub.",
      );
      cached = stub;
      return stub;
    }
    StripeCtor = (mod as { default?: unknown }).default ?? mod;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[billing/stripe] falha ao carregar SDK — caindo pra stub.",
    );
    cached = stub;
    return stub;
  }

  // ts-expect-error: o ctor real do Stripe vem dinamico.
  const client: unknown = new (StripeCtor as new (k: string) => unknown)(key);

  const real: StripeAdapter = {
    enabled: true,

    async reportUsage(input) {
      const c = client as {
        subscriptionItems: {
          createUsageRecord: (
            id: string,
            params: {
              quantity: number;
              timestamp: number;
              action?: "increment" | "set";
            },
            options?: { idempotencyKey?: string },
          ) => Promise<unknown>;
        };
      };
      await c.subscriptionItems.createUsageRecord(
        input.subscriptionItemId,
        {
          quantity: input.quantity,
          timestamp: input.timestamp,
          action: input.action ?? "increment",
        },
        { idempotencyKey: input.idempotencyKey },
      );
    },

    async retrieveSubscription(id) {
      const c = client as {
        subscriptions: {
          retrieve: (id: string) => Promise<{
            id: string;
            status: string;
            current_period_start: number;
            current_period_end: number;
            cancel_at_period_end: boolean;
            items: { data: Array<{ id: string; price: { metadata?: Record<string, string> } }> };
          }>;
        };
      };
      const sub = await c.subscriptions.retrieve(id);
      const meteredItems: Record<string, string> = {};
      for (const item of sub.items.data) {
        const meter = item.price?.metadata?.meter_key;
        if (meter) meteredItems[meter] = item.id;
      }
      return {
        id: sub.id,
        status: sub.status,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        meteredItems,
      };
    },

    verifyWebhook(rawBody, signature) {
      const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
      if (!secret) {
        throw new Error(
          "[billing/stripe] STRIPE_WEBHOOK_SECRET nao configurado.",
        );
      }
      const c = client as {
        webhooks: {
          constructEvent: (
            body: string,
            sig: string,
            secret: string,
          ) => { type: string; data: unknown };
        };
      };
      return c.webhooks.constructEvent(rawBody, signature, secret);
    },
  };

  cached = real;
  return real;
}

/** APENAS pra testes — invalida o cache pra recarregar do env. */
export function _resetStripeAdapterForTests(): void {
  cached = null;
}
