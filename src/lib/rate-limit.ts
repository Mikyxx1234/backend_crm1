/**
 * Rate-limit por organização / IP / usuário (PR 2.3).
 *
 * Backend
 * ───────
 * - **Self-host MVP**: `rate-limiter-flexible` com `RateLimiterRedis` apontando
 *   pro mesmo Redis usado por BullMQ/sseBus. Sliding-window com TTL por chave;
 *   atomicidade via Lua script da própria lib.
 * - **Fallback in-memory**: se `REDIS_URL` ausente, cai pra `RateLimiterMemory`
 *   (1 réplica, sem replicação). Garante que `next dev` local não exija Redis.
 * - **SaaS futuro (Upstash)**: a interface pública (`consumeRateLimit`,
 *   `withRateLimit`) é suficientemente abstrata para trocar pra
 *   `@upstash/ratelimit` sem mexer em call-sites — só recompilando este
 *   arquivo. Documentado em docs/rate-limit.md.
 *
 * Convenções de chave
 * ───────────────────
 * Toda chave é prefixada com `rl:` + scope para inspeção fácil no Redis CLI:
 *   - `rl:org:<organizationId>:<route>`
 *   - `rl:user:<userId>:<route>`
 *   - `rl:ip:<ip>:<route>`
 *
 * Nunca misturar IP e org na mesma chave — quem dispara abuso pode trocar
 * de IP, mas a organização não muda. O critério "pior ofensor primeiro" é
 * o `org` quando autenticado, `ip` em rotas públicas (login, signup).
 *
 * Multi-tier: o handler decide qual perfil usar (login=ip-strict,
 * api-padrão=org-default, AI tools=org-strict). Os perfis ficam centralizados
 * em `RATE_LIMIT_PROFILES` pra evitar mágica espalhada.
 */

import {
  RateLimiterMemory,
  RateLimiterRedis,
  type IRateLimiterStoreOptions,
  type RateLimiterAbstract,
  type RateLimiterRes,
} from "rate-limiter-flexible";

import { getLogger } from "@/lib/logger";
import { metrics, safeLabel } from "@/lib/metrics";

const log = getLogger("rate-limit");

/**
 * Perfis canônicos. Todo handler escolhe um destes — não inventar limites
 * ad-hoc na rota. Mudanças aqui se aplicam em massa.
 *
 * Os números são ponto de partida razoável pra um SaaS B2B em MVP; quando
 * tivermos métricas de tráfego real (Prom + grafana de PR 2.2), revisar
 * com base no p95 observado.
 */
export const RATE_LIMIT_PROFILES = {
  /** Endpoints quentes do CRM (mensagens, search, kanban). 600 req/min/org. */
  "api.default": { points: 600, durationSec: 60 },
  /** AI tools (geração de copy, drafts). LLMs custam $$ — 60 req/min/org. */
  "api.ai": { points: 60, durationSec: 60 },
  /** Webhooks do CRM (in vez de Meta). 120/min/org. */
  "api.webhooks": { points: 120, durationSec: 60 },
  /** Endpoints públicos sensíveis: login, signup, recover-password. 10 req/min/IP. */
  "auth.public": { points: 10, durationSec: 60 },
  /** Convites: previne enumeration. 30 tentativas/hora/IP. */
  "auth.invite": { points: 30, durationSec: 3600 },
  /** Bulk-ops (import contatos, export). 5/min/org. */
  "api.bulk": { points: 5, durationSec: 60 },
} as const satisfies Record<string, { points: number; durationSec: number }>;

export type RateLimitProfile = keyof typeof RATE_LIMIT_PROFILES;

type RateLimiterCacheKey = string;

const limiterCache = new Map<RateLimiterCacheKey, RateLimiterAbstract>();

let sharedRedis: import("ioredis").Redis | null = null;

function getRedisOrNull(): import("ioredis").Redis | null {
  if (sharedRedis) return sharedRedis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const IORedis = require("ioredis").default ?? require("ioredis");
    sharedRedis = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      keyPrefix: "",
      lazyConnect: false,
    });
    sharedRedis!.on("error", (err: Error) => {
      log.warn({ err }, "Redis rate-limit indisponível — fallback memória");
    });
    return sharedRedis;
  } catch (err) {
    log.warn({ err }, "Falha ao instanciar IORedis — usando memória");
    return null;
  }
}

function getLimiter(profile: RateLimitProfile): RateLimiterAbstract {
  const cached = limiterCache.get(profile);
  if (cached) return cached;
  const cfg = RATE_LIMIT_PROFILES[profile];

  const redis = getRedisOrNull();
  let limiter: RateLimiterAbstract;
  if (redis) {
    const opts: IRateLimiterStoreOptions = {
      storeClient: redis,
      keyPrefix: `rl:${profile}`,
      points: cfg.points,
      duration: cfg.durationSec,
      // Penalidade de bloqueio depois de estourar — nada mais agressivo
      // que a janela em si. Mantém comportamento "self-healing".
      blockDuration: 0,
      inMemoryBlockOnConsumed: cfg.points + 1,
      inMemoryBlockDuration: cfg.durationSec,
    };
    limiter = new RateLimiterRedis(opts);
  } else {
    limiter = new RateLimiterMemory({
      keyPrefix: `rl:${profile}`,
      points: cfg.points,
      duration: cfg.durationSec,
    });
  }
  limiterCache.set(profile, limiter);
  return limiter;
}

export type RateLimitDecision = {
  allowed: boolean;
  /** Pontos restantes na janela atual. */
  remaining: number;
  /** Quando a janela reseta (epoch ms). */
  resetAt: number;
  /** Header `Retry-After` (segundos) — só faz sentido se !allowed. */
  retryAfterSec: number;
  /** Limite total da janela (header `X-RateLimit-Limit`). */
  limit: number;
};

/**
 * Consome 1 ponto da chave dada no profile especificado. Idempotente,
 * thread-safe via Lua script no Redis.
 *
 * @param key chave estável (org/user/ip + route).
 * @param profile perfil de RATE_LIMIT_PROFILES.
 * @param points ponto a consumir (default 1).
 */
export async function consumeRateLimit(
  key: string,
  profile: RateLimitProfile,
  points = 1,
): Promise<RateLimitDecision> {
  const limiter = getLimiter(profile);
  const cfg = RATE_LIMIT_PROFILES[profile];
  try {
    const res = await limiter.consume(key, points);
    return {
      allowed: true,
      remaining: res.remainingPoints,
      resetAt: Date.now() + res.msBeforeNext,
      retryAfterSec: 0,
      limit: cfg.points,
    };
  } catch (err) {
    if (err instanceof Error && !("remainingPoints" in err)) {
      // Erro de infra (Redis fora?) → fail-open com warning.
      log.error({ err, profile, key }, "Rate-limit infra error — fail-open");
      return {
        allowed: true,
        remaining: cfg.points,
        resetAt: Date.now() + cfg.durationSec * 1000,
        retryAfterSec: 0,
        limit: cfg.points,
      };
    }
    const r = err as RateLimiterRes;
    return {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + r.msBeforeNext,
      retryAfterSec: Math.ceil(r.msBeforeNext / 1000),
      limit: cfg.points,
    };
  }
}

export type RateLimitScope = "org" | "user" | "ip";

export type WithRateLimitOpts = {
  /** Identificador da rota (template, não path). Vai pro key e pra métrica. */
  route: string;
  /** Profile do RATE_LIMIT_PROFILES. */
  profile: RateLimitProfile;
  /** Scope da chave — fonte do "id". */
  scope: RateLimitScope;
  /** Id estável (orgId, userId, ipv4/ipv6). */
  id: string | null | undefined;
  /** Pontos a consumir. Default 1. Use >1 pra rotas pesadas (ex.: bulk import = 10). */
  points?: number;
};

/**
 * Helper de alto nível para uso em handlers. Retorna:
 *   - `{ ok: true, headers }` quando dentro do limite (anexar `headers` na resposta)
 *   - `{ ok: false, response }` quando estourado (devolver direto a `Response` 429)
 */
export async function withRateLimit(
  opts: WithRateLimitOpts,
): Promise<
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response; headers: Record<string, string> }
> {
  if (!opts.id) {
    // Sem id estável (request anônimo sem ip resolvido?), fail-open. Cobertura
    // melhor cai no IP via getClientIp() que sempre devolve algo.
    return { ok: true, headers: {} };
  }
  const key = `${opts.scope}:${opts.id}:${opts.route}`;
  const decision = await consumeRateLimit(key, opts.profile, opts.points ?? 1);

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.floor(decision.resetAt / 1000)),
  };

  if (decision.allowed) {
    return { ok: true, headers };
  }

  metrics.errors.inc({
    scope: "rate-limit",
    kind: safeLabel(`${opts.profile}:${opts.scope}`),
  });
  log.warn(
    {
      route: opts.route,
      profile: opts.profile,
      scope: opts.scope,
      id: opts.id,
      retryAfterSec: decision.retryAfterSec,
    },
    "rate-limit excedido",
  );

  headers["Retry-After"] = String(decision.retryAfterSec);
  const response = new Response(
    JSON.stringify({
      error: "rate_limit_exceeded",
      message: "Muitas requisições. Tente novamente em instantes.",
      retryAfterSec: decision.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
    },
  );
  return { ok: false, response, headers };
}

/**
 * Extrai o IP do request — preferindo `x-forwarded-for` (proxy/CDN) e
 * caindo pra remoteAddress. Usado em rate-limit IP-based pra rotas
 * públicas (login/signup) onde o `userId`/`orgId` não está disponível.
 *
 * Chamado dentro de handlers Next, NÃO no middleware Edge — ali o request
 * vem como `NextRequest` e a API do Next muda. Em handlers Node, recebemos
 * `Request` padrão e os headers vêm do proxy.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}
