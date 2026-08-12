import { Pool, type PoolClient, type PoolConfig } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prisma adapter-pg só usa pool.connect() em forma Promise (sem callback).

/**
 * Cliente Prisma cru (sem extension de organizationId). Use quando:
 * - A query precisa atravessar orgs (ex.: painel /admin listando todas).
 * - O codigo roda antes do RequestContext existir (NextAuth.authorize,
 *   jwt callback, middleware de edge — que aliás não importa prisma).
 * - Scripts/seed precisam criar a primeira org "EduIT" sem ter contexto.
 *
 * Para qualquer codigo de request em API/page scoped, prefira o cliente
 * scoped exportado em @/lib/prisma (que e esta base + extension de
 * organization-scope).
 */

const globalForPrisma = globalThis as unknown as {
  prismaBase: PrismaClient | undefined;
};

function envInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (!v) return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function appMode(): string {
  return (process.env.APP_MODE ?? "api").trim().toLowerCase() || "api";
}

/**
 * Defaults por APP_MODE — workers NÃO devem competir com a API pelo
 * orçamento de `max_connections` do Postgres compartilhado.
 *
 * - api: 20 (inbox/pipeline/board sob carga)
 * - worker-whatsapp: 6 (dispatch=2 + send≈4; campanha precisa headroom)
 * - demais workers: 4 (alinhado a concurrency ≤ pool)
 */
function defaultPoolMax(): number {
  const mode = appMode();
  if (!mode.startsWith("worker")) return 20;
  if (mode === "worker-whatsapp") return 6;
  return 4;
}

/** Erro clássico do `pg-pool` quando `connectionTimeoutMillis` estoura. */
export function isPgPoolTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /timeout exceeded when trying to connect/i.test(err.message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry 1x em pool timeout. Seguro para read e write: o timeout ocorre
 * ANTES de checkout — a query ainda não começou.
 */
export async function withPgPoolRetry<T>(
  fn: () => Promise<T>,
  label?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isPgPoolTimeoutError(err)) throw err;
    const mode = appMode();
    console.warn(
      `[prisma-base] pool timeout APP_MODE=${mode}` +
        (label ? ` op=${label}` : "") +
        " — retry 1x",
    );
    await sleep(50 + Math.floor(Math.random() * 100));
    return await fn();
  }
}

/**
 * Pool com log identificando APP_MODE + retry único no acquire.
 * Cobre o caso em que vários jobs/requests esperam slot e estouram
 * `DB_POOL_CONN_TIMEOUT_MS` (mensagem: "timeout exceeded when trying to connect").
 */
function createInstrumentedPool(
  config: PoolConfig,
  mode: string,
  poolMax: number,
): Pool {
  const pool = new Pool(config);

  const logExhausted = (phase: string) => {
    console.warn(
      `[prisma-base] pool exhausted APP_MODE=${mode} phase=${phase}` +
        ` max=${poolMax}` +
        ` total=${pool.totalCount}` +
        ` idle=${pool.idleCount}` +
        ` waiting=${pool.waitingCount}`,
    );
  };

  const originalConnect = pool.connect.bind(pool) as {
    (): Promise<PoolClient>;
  };

  // Só a forma Promise — adapter-pg não usa callback.
  (pool as { connect: () => Promise<PoolClient> }).connect =
    async function connectWithRetry(): Promise<PoolClient> {
      try {
        return await originalConnect();
      } catch (err) {
        if (!isPgPoolTimeoutError(err)) throw err;
        logExhausted("retrying once");
        await sleep(50 + Math.floor(Math.random() * 100));
        try {
          return await originalConnect();
        } catch (err2) {
          if (isPgPoolTimeoutError(err2)) logExhausted("giving up");
          throw err2;
        }
      }
    };

  return pool;
}

function createPrismaClient() {
  // Pool config tunado para multi-tenant SaaS:
  //
  //   - DB_POOL_MAX (default por APP_MODE — ver defaultPoolMax): conexoes
  //     concorrentes ATIVAS por processo. Em prod EasyPanel tipico
  //     (1 API + 3 workers) cabe em max_connections=100 com folga.
  //   - DB_POOL_IDLE_TIMEOUT_MS (default 30s): idle conn devolve pro
  //     pool depois desse tempo. Reduz pressao em janelas de baixo
  //     trafego (off-hours).
  //   - DB_POOL_CONN_TIMEOUT_MS (default 8s): tempo max esperando uma
  //     conn livre no pool OU TCP ao Postgres. Se estourar → erro
  //     "timeout exceeded when trying to connect" (pg-pool).
  //   - DB_STATEMENT_TIMEOUT_MS (default 30s): mata queries individuais
  //     que demoram mais que isso. Evita N+1 acidentais em endpoints
  //     publicos drenarem o pool inteiro.
  //
  // Tunar via env. Defaults ja servem dev e prod pequena (1-2 replicas).
  const mode = appMode();
  const max = envInt("DB_POOL_MAX", defaultPoolMax());
  const idleTimeoutMillis = envInt("DB_POOL_IDLE_TIMEOUT_MS", 30_000);
  const connectionTimeoutMillis = envInt("DB_POOL_CONN_TIMEOUT_MS", 8_000);
  const statementTimeoutMs = envInt("DB_STATEMENT_TIMEOUT_MS", 30_000);

  // application_name aparece em pg_stat_activity — facilita achar quem
  // segura conexao quando max_connections aperta.
  const appName = `crm_${mode}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 63);

  const pool = createInstrumentedPool(
    {
      connectionString: process.env.DATABASE_URL,
      max,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      // statement_timeout + application_name em cada conexao nova.
      options: `-c statement_timeout=${statementTimeoutMs} -c application_name=${appName}`,
    },
    mode,
    max,
  );

  // Resiliencia: log mas nao crash em erros transientes do pool.
  pool.on("error", (err) => {
    console.warn(
      `[prisma-base] pool error APP_MODE=${mode} (continuando):`,
      err.message,
    );
  });

  console.info(
    `[prisma-base] pool ready APP_MODE=${mode} max=${max}` +
      ` connTimeoutMs=${connectionTimeoutMillis}` +
      ` idleTimeoutMs=${idleTimeoutMillis}` +
      ` statementTimeoutMs=${statementTimeoutMs}` +
      ` application_name=${appName}`,
  );

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? [{ emit: "stdout", level: "warn" }, { emit: "stdout", level: "error" }]
        : ["error"],
  });
}

export const prismaBase =
  globalForPrisma.prismaBase ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = prismaBase;
