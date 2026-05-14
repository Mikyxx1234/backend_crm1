/**
 * Inicialização do OpenTelemetry SDK Node (PR 2.2).
 *
 * Este módulo é carregado *dinamicamente* por `src/instrumentation.ts` apenas
 * quando:
 *   - `process.env.NEXT_RUNTIME === "nodejs"` (não tem como instrumentar Edge)
 *   - `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` está setado
 *
 * Sem essas duas condições, o módulo nem é importado — zero overhead.
 *
 * Pacotes auto-instrumentados (subset relevante):
 *   - HTTP/HTTPS (incoming + outgoing fetch)
 *   - PG (Prisma usa pg via adapter; spans para SELECT/INSERT/UPDATE)
 *   - IORedis (BullMQ + sseBus)
 *   - Pino (correlaciona log ↔ trace via trace_id/span_id)
 *
 * Não habilitamos `@opentelemetry/instrumentation-fs` por design: gera ruído
 * absurdo (1 span por arquivo lido). Caso precise debug de IO, ative pontual.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  PeriodicExportingMetricReader,
  type MetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";

let sdk: NodeSDK | null = null;

export async function startOtel(): Promise<void> {
  if (sdk) return; // idempotente

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const serviceName = process.env.OTEL_SERVICE_NAME ?? "crm-eduit";
  const serviceVersion =
    process.env.OTEL_SERVICE_VERSION ?? process.env.npm_package_version ?? "0.0.0";

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    "deployment.environment": process.env.NODE_ENV ?? "development",
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
  });

  const metricReader: MetricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
    }),
    exportIntervalMillis: 30_000,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Ruído puro: 1 span por arquivo lido.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        // Nosso server SSR + API roda http; quero o span só pra incoming.
        "@opentelemetry/instrumentation-http": {
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? "";
            // healthcheck e métrica não precisam virar trace.
            return (
              url.startsWith("/api/health") ||
              url.startsWith("/api/metrics") ||
              url.startsWith("/_next/static")
            );
          },
        },
      }),
      new PinoInstrumentation({
        // injeta trace_id/span_id no record do logger automaticamente.
        logKeys: {
          traceId: "traceId",
          spanId: "spanId",
          traceFlags: "traceFlags",
        },
      }),
    ],
  });

  sdk.start();

  const shutdown = async () => {
    try {
      await sdk?.shutdown();
    } catch {
      // best-effort
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
