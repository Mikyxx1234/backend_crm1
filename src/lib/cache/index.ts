/**
 * Cache Redis para hot configs (PR 5.1).
 *
 * Implementa o padrao **cache-aside** (look-aside) com fallback
 * in-memory: se `REDIS_URL` ausente (ou Redis morto), todas as
 * chamadas viram pass-through pro loader e o app continua funcionando.
 * Isso e essencial pra `next dev` e pra resiliencia em prod (cache
 * deve ser opcional, nao bloqueante).
 *
 * ## Quando usar
 *
 * - **SIM:** payloads que mudam raramente e sao lidos em hot path.
 *   Exemplos:
 *     - `Channel` (lookup por id em cada inbound message do webhook).
 *     - `AIAgentConfig` (lookup por userId em cada turn de bot).
 *     - `Organization.branding` (lookup por slug em cada SSR de
 *       paginas publicas).
 * - **NAO:**
 *     - Listagens grandes (kanban, conversations) — invalidacao
 *       cara, payload muda toda hora.
 *     - Counters / aggregates — usar `INCR` direto, nao este helper.
 *     - Dados sensiveis sem TTL curto (PII, tokens) — stale =
 *       leak window.
 *
 * ## Convencoes
 *
 * - Chaves prefixadas com `cache:` pra inspecao no Redis CLI.
 * - Sempre com namespace (entity) + chave estavel:
 *     `cache:channel:<id>` / `cache:ai_agent:<userId>` /
 *     `cache:org:<slug>`.
 * - TTL DEFAULT = 60s. Justificativa: balanco entre hit-rate e
 *   janela de inconsistencia. Hot configs invalidam EXPLICITAMENTE
 *   no servico de update (ver `services/channels.ts.updateChannel`)
 *   — o TTL e seguro de ultima linha pra cobrir caches orfaos
 *   (deploy de outra replica, drift de schema).
 *
 * ## Invalidacao
 *
 * Sempre que um caller modifica um recurso cacheado, **deve** chamar
 * `cache.del(key)` no mesmo path. Nao confiar exclusivamente em TTL.
 * Helpers `invalidate*` em `cache/keys.ts`.
 *
 * ## Stampede protection
 *
 * `wrap()` usa lock distribuido leve via `SET NX PX` antes de chamar
 * o loader. Concurrent requests pra chave fria recebem o resultado do
 * primeiro loader (atraves do retry curto). Isso evita 100 queries
 * pro DB quando uma chave hot expira.
 */
import IORedis, { type Redis as IORedisClient } from "ioredis";

import { getLogger } from "@/lib/logger";
import { metrics, safeLabel } from "@/lib/metrics";

const log = getLogger("cache");

const KEY_PREFIX = "cache:";
const LOCK_PREFIX = "cache-lock:";
const DEFAULT_TTL_SEC = 60;
const LOCK_TTL_MS = 5_000;
const STAMPEDE_RETRY_DELAY_MS = 50;
const STAMPEDE_MAX_RETRIES = 6;

let redis: IORedisClient | null = null;
let redisDisabled = false;

function getClient(): IORedisClient | null {
  if (redisDisabled) return null;
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    redisDisabled = true;
    log.info("[cache] REDIS_URL ausente — usando fallback in-memory.");
    return null;
  }
  try {
    redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      // Cache nao deve segurar request — se Redis cair, fallback.
      connectTimeout: 1_000,
      commandTimeout: 500,
      lazyConnect: false,
    });
    redis.on("error", (err) => {
      log.warn({ err }, "[cache] redis client error (continuando com fallback)");
    });
    return redis;
  } catch (err) {
    log.warn({ err }, "[cache] falha ao criar redis client — fallback");
    redisDisabled = true;
    return null;
  }
}

// ── Fallback in-memory ─────────────────────────────────────────────
//
// Map<key, { value, expiresAt }>. Sem LRU — limite simples por count
// pra evitar leak em dev/test. Em prod com Redis, este Map nunca e
// usado.

const MEMORY_MAX_ENTRIES = 1_000;
const memoryStore = new Map<string, { value: unknown; expiresAt: number }>();

function memoryGet<T>(key: string): T | undefined {
  const hit = memoryStore.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function memorySet<T>(key: string, value: T, ttlSec: number): void {
  if (memoryStore.size >= MEMORY_MAX_ENTRIES) {
    // Eviccao primitiva — apaga o primeiro inserido.
    const firstKey = memoryStore.keys().next().value;
    if (firstKey) memoryStore.delete(firstKey);
  }
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

function memoryDel(key: string): void {
  memoryStore.delete(key);
}

// ── API publica ────────────────────────────────────────────────────

export type CacheKey = string;

export interface CacheOptions {
  /** TTL em segundos. Default 60s. */
  ttlSec?: number;
  /** Pular cache (forca loader). Util pra debug. */
  skipCache?: boolean;
}

/**
 * Le valor do cache. Retorna undefined se ausente / parsing falhar /
 * Redis indisponivel.
 */
export async function get<T>(key: CacheKey): Promise<T | undefined> {
  const fullKey = KEY_PREFIX + key;
  const client = getClient();
  if (!client) return memoryGet<T>(fullKey);

  try {
    const raw = await client.get(fullKey);
    if (!raw) {
      metrics.cacheMisses?.inc({ key: safeLabel(key.split(":")[0]) });
      return undefined;
    }
    metrics.cacheHits?.inc({ key: safeLabel(key.split(":")[0]) });
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn({ err, key }, "[cache] get falhou — fallback memoria");
    return memoryGet<T>(fullKey);
  }
}

/**
 * Grava valor com TTL. Falha silenciosa.
 */
export async function set<T>(
  key: CacheKey,
  value: T,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<void> {
  const fullKey = KEY_PREFIX + key;
  const client = getClient();
  const payload = JSON.stringify(value);

  if (!client) {
    memorySet(fullKey, value, ttlSec);
    return;
  }
  try {
    await client.set(fullKey, payload, "EX", ttlSec);
  } catch (err) {
    log.warn({ err, key }, "[cache] set falhou — fallback memoria");
    memorySet(fullKey, value, ttlSec);
  }
}

/**
 * Apaga uma chave. Aceita varias chaves de uma vez.
 */
export async function del(...keys: CacheKey[]): Promise<void> {
  if (keys.length === 0) return;
  const fullKeys = keys.map((k) => KEY_PREFIX + k);
  const client = getClient();
  if (!client) {
    for (const k of fullKeys) memoryDel(k);
    return;
  }
  try {
    await client.del(...fullKeys);
  } catch (err) {
    log.warn({ err, keys }, "[cache] del falhou");
  }
  for (const k of fullKeys) memoryDel(k);
}

/**
 * Apaga todas as chaves matching um padrao (ex.: `channel:*`). USAR
 * COM CUIDADO — em prod com 1M+ chaves, `KEYS` trava o Redis. Aqui
 * usamos `SCAN` em batch.
 */
export async function delPattern(pattern: string): Promise<number> {
  const fullPattern = KEY_PREFIX + pattern;
  const client = getClient();
  if (!client) {
    let n = 0;
    for (const k of memoryStore.keys()) {
      if (matchesGlob(k, fullPattern)) {
        memoryStore.delete(k);
        n++;
      }
    }
    return n;
  }
  let cursor = "0";
  let total = 0;
  try {
    do {
      const [next, batch] = await client.scan(
        cursor,
        "MATCH",
        fullPattern,
        "COUNT",
        100,
      );
      cursor = next;
      if (batch.length > 0) {
        await client.del(...batch);
        total += batch.length;
      }
    } while (cursor !== "0");
  } catch (err) {
    log.warn({ err, pattern }, "[cache] delPattern falhou");
  }
  return total;
}

/**
 * Cache-aside helper. Le do cache; se ausente, chama loader, grava e
 * retorna. Inclui stampede protection — 1 loader por chave por vez.
 *
 * @example
 *   const channel = await cache.wrap(`channel:${id}`, 60, () =>
 *     prismaBase.channel.findUnique({ where: { id } })
 *   );
 */
export async function wrap<T>(
  key: CacheKey,
  ttlSec: number,
  loader: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  if (options.skipCache) {
    return loader();
  }

  const cached = await get<T>(key);
  if (cached !== undefined) return cached;

  const lockKey = LOCK_PREFIX + key;
  const client = getClient();

  if (client) {
    let acquired = false;
    try {
      const reply = await client.set(lockKey, "1", "PX", LOCK_TTL_MS, "NX");
      acquired = reply === "OK";
    } catch (err) {
      log.warn({ err, key }, "[cache] lock falhou — seguindo sem stampede protection");
    }

    if (!acquired) {
      // Outro request esta carregando — espera curto e tenta read.
      for (let i = 0; i < STAMPEDE_MAX_RETRIES; i++) {
        await new Promise((r) => setTimeout(r, STAMPEDE_RETRY_DELAY_MS));
        const retry = await get<T>(key);
        if (retry !== undefined) return retry;
      }
      // Loader fica como fallback se o lock holder demorou demais.
    }

    try {
      const value = await loader();
      await set(key, value, ttlSec);
      return value;
    } finally {
      if (acquired) {
        client.del(lockKey).catch(() => undefined);
      }
    }
  }

  const value = await loader();
  await set(key, value, ttlSec);
  return value;
}

function matchesGlob(input: string, pattern: string): boolean {
  // Glob simplificado: `*` -> `.*`, escapa o resto.
  const re = new RegExp(
    "^" +
      pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
      "$",
  );
  return re.test(input);
}

export const cache = {
  get,
  set,
  del,
  delPattern,
  wrap,
};

export type { CacheOptions as Options };
