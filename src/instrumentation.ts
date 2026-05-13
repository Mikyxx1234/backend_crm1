/**
 * Hook de arranque do servidor Node.
 *
 * NOTE: Heavy server-only modules (pg, ioredis, prisma) CANNOT be imported here
 * — even via dynamic import() — because Next.js bundles instrumentation.ts for
 * both Node.js and Edge runtimes, and webpack traces the dependency graph.
 *
 * The timeout sweeper is started lazily from src/lib/sse-bus.ts instead,
 * which is only loaded by server-side API routes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Server-side init that doesn't depend on pg/ioredis goes here.
}
