/**
 * Feature flags por organizacao (PR 5.4).
 *
 * Permite rollouts graduais e diferenciacao de planos comerciais sem
 * branchar codigo. Flags sao pre-definidas aqui (lista canonica) e
 * podem ser sobrescritas por organizacao via tabela
 * `organization_feature_flags` (ou env override em dev).
 *
 * Hierarquia de resolucao (primeira fonte que retornar wins):
 *   1. Override por env (`FEATURE_FLAG_<KEY>=true|false`) — util em dev.
 *   2. Override em DB (`OrganizationFeatureFlag.enabled` para a org).
 *   3. Default global (`FLAGS[key].defaultEnabled`).
 *
 * O resultado e cacheado em Redis (TTL 60s) por org+flag pra evitar
 * round-trip a cada request. Cache e invalidado em writes via
 * `setFeatureFlag`.
 *
 * @see docs/feature-flags.md
 */
import { prismaBase } from "@/lib/prisma-base";
import { cache } from "@/lib/cache";

/* ───────────────────────────── lista canonica ──────────────────── */

/**
 * Lista canonica de flags suportadas. Adicionar uma flag nova:
 *   1. Adicione a entry aqui (default conservador, off).
 *   2. Documente em docs/feature-flags.md.
 *   3. Use `await isFeatureEnabled("...")` no codigo.
 *   4. Quando ja deu rollout completo, remova o branch e a flag.
 *
 * Convencoes:
 *   - `key` em snake_case.
 *   - `defaultEnabled` na duvida = false (rollout por opt-in).
 *   - `description` curta — humanos leem isso no painel admin.
 */
export const FLAGS = {
  rbac_granular_scope_v1: {
    key: "rbac_granular_scope_v1",
    description: "Ativa enforcement granular por funil/etapa/campo/sidebar.",
    defaultEnabled: false,
  },
  ai_agent_v2: {
    key: "ai_agent_v2",
    description: "Habilita o pipeline novo do agente IA (RAG + tools v2).",
    defaultEnabled: false,
  },
  whatsapp_call_recording: {
    key: "whatsapp_call_recording",
    description:
      "Grava chamadas de voz WhatsApp. Requer aceite explicito do cliente.",
    defaultEnabled: false,
  },
  campaign_metered_billing: {
    key: "campaign_metered_billing",
    description: "Cobra por mensagem enviada em campanhas (Stripe metered).",
    defaultEnabled: false,
  },
  beta_kanban_v2: {
    key: "beta_kanban_v2",
    description: "Novo kanban com agrupamento e batch ops (preview).",
    defaultEnabled: false,
  },
  read_replica_for_analytics: {
    key: "read_replica_for_analytics",
    description:
      "Roteia analytics para a read replica (PR 5.2). On por default em prod.",
    defaultEnabled: true,
  },
  campaign_builder_v2: {
    key: "campaign_builder_v2",
    description:
      "Ativa o novo wizard de campanhas com fluxo em 4 passos.",
    defaultEnabled: false,
  },
} as const;

export type FlagKey = keyof typeof FLAGS;

const TTL_SEC = 60;

/* ───────────────────────────── helpers ─────────────────────────── */

function envOverride(key: FlagKey): boolean | undefined {
  const envName = `FEATURE_FLAG_${key.toUpperCase()}`;
  const raw = process.env[envName];
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

function cacheKey(orgId: string, key: FlagKey): string {
  return `ff:${orgId}:${key}`;
}

/**
 * Resolve uma flag para uma organizacao especifica.
 *
 * @example
 * if (await isFeatureEnabled("ai_agent_v2", orgId)) {
 *   // novo pipeline
 * }
 */
export async function isFeatureEnabled(
  key: FlagKey,
  organizationId: string,
): Promise<boolean> {
  // env wins — util em dev/staging para ligar tudo sem tocar no DB.
  const envValue = envOverride(key);
  if (envValue !== undefined) return envValue;

  return cache.wrap(cacheKey(organizationId, key), TTL_SEC, async () => {
    const row = await prismaBase.organizationFeatureFlag.findUnique({
      where: {
        organizationId_key: {
          organizationId,
          key,
        },
      },
      select: { enabled: true },
    });
    if (row) return row.enabled;
    return FLAGS[key].defaultEnabled;
  });
}

/**
 * Versao "load all" — pra hidratar o cliente com o estado completo
 * de uma org de uma vez (ex.: `/api/me`).
 */
export async function loadAllFlags(
  organizationId: string,
): Promise<Record<FlagKey, boolean>> {
  const overrides = await prismaBase.organizationFeatureFlag.findMany({
    where: { organizationId },
    select: { key: true, enabled: true },
  });
  const map = new Map(overrides.map((r) => [r.key, r.enabled]));
  const out: Partial<Record<FlagKey, boolean>> = {};
  for (const k of Object.keys(FLAGS) as FlagKey[]) {
    const env = envOverride(k);
    if (env !== undefined) {
      out[k] = env;
      continue;
    }
    out[k] = map.has(k) ? Boolean(map.get(k)) : FLAGS[k].defaultEnabled;
  }
  return out as Record<FlagKey, boolean>;
}

/**
 * Atribui (ou cria) o override de uma flag pra uma organizacao.
 * Invalida o cache. Apenas super-admin deve chamar — autorizacao
 * fica no caller (rota admin).
 */
export async function setFeatureFlag(args: {
  organizationId: string;
  key: FlagKey;
  enabled: boolean;
  setById?: string | null;
  notes?: string | null;
  value?: unknown;
}): Promise<void> {
  const { organizationId, key, enabled, setById, notes, value } = args;
  await prismaBase.organizationFeatureFlag.upsert({
    where: {
      organizationId_key: { organizationId, key },
    },
    update: {
      enabled,
      setById: setById ?? null,
      notes: notes ?? null,
      value: value as never,
    },
    create: {
      organizationId,
      key,
      enabled,
      setById: setById ?? null,
      notes: notes ?? null,
      value: value as never,
    },
  });
  await cache.del(cacheKey(organizationId, key));
}

/**
 * Remove o override de uma flag — volta ao default.
 */
export async function clearFeatureFlag(
  organizationId: string,
  key: FlagKey,
): Promise<void> {
  await prismaBase.organizationFeatureFlag
    .delete({
      where: { organizationId_key: { organizationId, key } },
    })
    .catch(() => undefined);
  await cache.del(cacheKey(organizationId, key));
}
