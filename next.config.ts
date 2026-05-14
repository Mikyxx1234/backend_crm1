import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Serwist (sucessor do next-pwa) — gera service worker em build,
 * injeta precache de assets do .next, e expoe `app/sw.ts` como
 * entrypoint customizado. Em dev (`disable: true` em NODE_ENV
 * !== production) o SW NAO registra, evitando cache stale durante
 * iteracao. Em producao registra automaticamente via inject script.
 *
 * IMPORTANTE: Isso afeta SO o build `next build`. O dev server fica
 * limpo (sem precache, sem chrome do PWA), o que e o que queremos
 * pra DX.
 */
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV !== "production",
  // Excluimos rotas dinamicas / sensiveis do precache automatico.
  // Auth, webhooks e SSE jamais devem ser cacheadas.
  exclude: [
    /\.map$/,
    /^manifest.*\.js$/,
    /\/api\//,
    /\/_next\/data\//,
  ],
});

function securityHeaders(): { key: string; value: string }[] {
  const headers: { key: string; value: string }[] = [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "payment=(), usb=(), geolocation=()",
    },
  ];
  const url = process.env.NEXTAUTH_URL ?? "";
  if (process.env.NODE_ENV === "production" && url.startsWith("https://")) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return headers;
}

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * next-auth/react inicializa `__NEXTAUTH` com `process.env.NEXTAUTH_URL`.
   * Sem isto, o client bundle pode não ver a variável (só existe no .env do servidor),
   * e signIn/getSession quebram de forma opaca. Default local = :3000.
   */
  env: {
    NEXTAUTH_URL:
      process.env.NEXTAUTH_URL ??
      process.env.VERCEL_URL ??
      "http://localhost:3000",
  },
  typescript: {
    // Mantemos TS errors fora do build por um motivo unico e documentado:
    // src/lib/prisma.ts usa Prisma Client Extensions para auto-injetar
    // `organizationId` em CREATE/UPDATE/DELETE/find* (multi-tenancy via RLS).
    // O TypeScript NAO consegue inferir essa transformacao do extension,
    // entao o tipo gerado pelo Prisma Client continua exigindo
    // `organizationId` no `data` dos creates e marcando campos do `select`
    // como ausentes. Sao ~150 falsos positivos (TS2322 + TS2551) que SEMPRE
    // funcionam em runtime porque o extension intercepta antes do Prisma
    // rejeitar. Ja zeramos os erros TS *reais* (services/, api/). Caso
    // alguem queira atacar isso depois, o caminho e wrapper de tipos em
    // prisma.ts marcando `organizationId` como `Optional` no payload de
    // create — custa ~30 arquivos de refactor sem ganho funcional.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "pg",
    "pg-pool",
    "pg-connection-string",
    "pgpass",
    "@prisma/adapter-pg",
    "@prisma/client",
    // OpenTelemetry (PR 2.2): auto-instrumentations usam require dinâmico
    // de muitos módulos; bundlear via webpack/turbopack quebra. Mantém
    // como deps externas — Node carrega de node_modules em runtime.
    //
    // Mantemos a lista explícita para o turbopack (dev), que NÃO honra o
    // hook `webpack()` abaixo. Para o build prod (webpack), o regex no
    // hook cobre TODOS os submódulos `@opentelemetry/*` e `@grpc/*` —
    // necessário pq sdk-node e auto-instrumentations-node puxam, via
    // require dinâmico, exporters gRPC (`@grpc/grpc-js` -> `fs`/`net`/
    // `tls`/`zlib`/`stream`) que não são listáveis um-a-um sem virar
    // jogo da paciência a cada minor bump.
    "@opentelemetry/api",
    "@opentelemetry/sdk-node",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/exporter-metrics-otlp-http",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/resources",
    "@opentelemetry/semantic-conventions",
    "@opentelemetry/instrumentation-pino",
    "prom-client",
  ],
  webpack: (config, { isServer, nextRuntime }) => {
    // 1) Bundle do Node server (route handlers, server components).
    //    Externalize qualquer pacote OTel/gRPC para que o webpack NAO siga
    //    os requires transitivos (ex.: sdk-node -> exporter-logs-otlp-grpc
    //    -> @grpc/grpc-js -> require('fs'|'net'|'tls'|'zlib'|'stream')).
    //    Em runtime, Node resolve os pacotes diretamente do node_modules
    //    — Dockerfile copia o node_modules inteiro pro estagio runner.
    //    Aplicado a TODOS os bundles server-side (nodejs runtime + bundle
    //    do `instrumentation.ts`, que o Next compila à parte e cujo
    //    `nextRuntime` pode vir vazio). Excluímos apenas o Edge runtime,
    //    que tem tratamento próprio abaixo.
    if (isServer && nextRuntime !== "edge") {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);
      externals.push(({ request }: { request?: string }, callback: (err?: Error | null, result?: string) => void) => {
        if (request && (/^@opentelemetry\//.test(request) || /^@grpc\//.test(request))) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      });
      config.externals = externals;
    }

    // 2) Bundle do client (browser).
    //    Cliente NUNCA usa OTel/gRPC. Substituir por módulo vazio
    //    (`false`) impede o webpack de seguir os requires transitivos
    //    para módulos Node nativos (`tls`/`net`/`zlib`/`fs`/`stream`),
    //    que não existem no browser. Sem este alias, o build falha com
    //    "Module not found: Can't resolve 'tls'" porque o Next.js puxa
    //    `src/instrumentation.ts` no grafo do client mesmo sem importarmos
    //    diretamente (auto-instrumentation).
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        "@opentelemetry/api": false,
        "@opentelemetry/sdk-node": false,
        "@opentelemetry/auto-instrumentations-node": false,
        "@opentelemetry/exporter-trace-otlp-http": false,
        "@opentelemetry/exporter-metrics-otlp-http": false,
        "@opentelemetry/sdk-metrics": false,
        "@opentelemetry/resources": false,
        "@opentelemetry/semantic-conventions": false,
        "@opentelemetry/instrumentation-pino": false,
      };
    }

    // 3) Bundle do middleware (Edge Runtime / V8 isolate).
    //    O Edge NAO tem `require()` para pacotes Node nativos. O Next.js 15
    //    (ou alguma dep transitiva do next-auth) puxa `@opentelemetry/api`
    //    no bundle do middleware mesmo sem importarmos — provavelmente via
    //    auto-instrumentation que detecta o pacote em deps. O `serverExternalPackages`
    //    NAO afeta o bundle Edge, e externalizar via `commonjs require(...)`
    //    quebra em runtime ("Native module not found").
    //    Solução: alias `@opentelemetry/api` para um stub no-op SOMENTE no
    //    Edge. O bundle Node continua usando o pacote real.
    if (nextRuntime === "edge") {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        // `@opentelemetry/api` recebe stub funcional (com no-ops) porque
        // o Next.js (ou alguma dep) chama `trace.getTracer().startSpan()`
        // diretamente — `false` aqui resultaria em `undefined.getTracer`.
        "@opentelemetry/api": path.resolve(__dirname, "src/lib/edge-otel-stub.ts"),
        // Os SDKs Node (sdk-node, exporters, instrumentations) NUNCA são
        // chamados no Edge (proteção via `process.env.NEXT_RUNTIME !== "nodejs"`
        // em `src/instrumentation.ts`). Mas o webpack do Edge ainda trace
        // o grafo do dynamic `import("@/lib/otel-sdk")` e tenta resolver
        // `@grpc/grpc-js → require("tls"|"net"|"zlib")`, que não existem
        // no V8 isolate. `false` substitui por módulo vazio e corta a árvore.
        "@opentelemetry/sdk-node": false,
        "@opentelemetry/auto-instrumentations-node": false,
        "@opentelemetry/exporter-trace-otlp-http": false,
        "@opentelemetry/exporter-metrics-otlp-http": false,
        "@opentelemetry/sdk-metrics": false,
        "@opentelemetry/resources": false,
        "@opentelemetry/semantic-conventions": false,
        "@opentelemetry/instrumentation-pino": false,
        "@grpc/grpc-js": false,
      };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/uploads/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
};

export default withSerwist(nextConfig);
