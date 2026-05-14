import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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

function createPrismaClient() {
  // Pool config tunado para multi-tenant SaaS:
  //
  //   - DB_POOL_MAX (default 20): conexoes concorrentes ATIVAS por replica.
  //     Em prod com 4 replicas = 80 conexoes totais. Postgres default
  //     max_connections = 100 — deixa folga pra superuser/admin/scripts.
  //   - DB_POOL_IDLE_TIMEOUT_MS (default 30s): idle conn devolve pro
  //     pool depois desse tempo. Reduz pressao em janelas de baixo
  //     trafego (off-hours).
  //   - DB_POOL_CONN_TIMEOUT_MS (default 5s): tempo max esperando uma
  //     conn livre no pool. Se estourar, request retorna 503 — melhor
  //     que travar pra sempre.
  //   - DB_STATEMENT_TIMEOUT_MS (default 30s): mata queries individuais
  //     que demoram mais que isso. Evita N+1 acidentais em endpoints
  //     publicos drenarem o pool inteiro.
  //
  // Tunar via env. Defaults ja servem dev e prod pequena (1-2 replicas).
  const max = envInt("DB_POOL_MAX", 20);
  const idleTimeoutMillis = envInt("DB_POOL_IDLE_TIMEOUT_MS", 30_000);
  const connectionTimeoutMillis = envInt("DB_POOL_CONN_TIMEOUT_MS", 5_000);
  const statementTimeoutMs = envInt("DB_STATEMENT_TIMEOUT_MS", 30_000);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    // statement_timeout aplicado a cada conexao recem-criada, antes de
    // entrar no pool. Pg cuida de propagar pra cada query subsequente.
    options: `-c statement_timeout=${statementTimeoutMs}`,
  });

  // Resiliencia: log mas nao crash em erros transientes do pool.
  pool.on("error", (err) => {
    console.warn("[prisma-base] pool error (continuando):", err.message);
  });

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
