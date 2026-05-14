import { Prisma } from "@prisma/client";

import { prismaBase } from "@/lib/prisma-base";
import {
  deepInjectOrgId,
  mergeData,
  mergeWhere,
} from "@/lib/prisma-tenant-helpers";
import {
  enterRequestContext,
  getRequestContext,
  type RequestContext,
} from "@/lib/request-context";

/**
 * Cliente Prisma com extension de organization-scope aplicada.
 *
 * Isolamento multi-tenant — camada 1 (aplicacao):
 *   - READ (find*, count, aggregate, groupBy): injeta where.organizationId
 *   - CREATE: injeta data.organizationId
 *   - UPDATE/DELETE: exige where.organizationId
 *   - UPSERT: injeta nos 3 (where, create, update)
 *
 * Comportamento conforme o RequestContext atual:
 *   a) Contexto com super-admin=true  -> bypass total (sem injection)
 *   b) Contexto com organizationId    -> injecao normal
 *   c) Sem contexto                   -> THROW — protege contra leak.
 *
 * Models que NAO recebem injection (listados como "global"):
 *   - Organization, User, SystemSetting, MetaPricingDailyMetric
 *   (User fica de fora pra nao quebrar login/jwt — paginas de /settings/team
 *    filtram por organizationId manualmente no where.)
 *
 * Se alguma rota precisa cruzar orgs (ex.: webhook que ainda nao resolveu
 * canal, script de manutencao, seed), importe `prismaBase` de
 * @/lib/prisma-base.
 */

const SCOPED_MODELS = new Set<Prisma.ModelName>([
  "Contact",
  "Company",
  "ContactPhoneChange",
  "Tag",
  "CustomField",
  "ContactCustomFieldValue",
  "DealCustomFieldValue",
  "ProductCustomFieldValue",
  "Pipeline",
  "Stage",
  "Deal",
  "DealProduct",
  "DealEvent",
  "Product",
  "Activity",
  "Note",
  "Conversation",
  "Message",
  "WhatsappCallEvent",
  "ScheduledWhatsappCall",
  "ScheduledMessage",
  "Automation",
  "AutomationStep",
  "AutomationLog",
  "AutomationContext",
  "Channel",
  "BaileysAuthKey",
  "QuickReply",
  "MessageTemplate",
  "WhatsAppTemplateConfig",
  // Flow: só a definição tem organizationId; screens/campos/mappings
  // ligam-se por flowId — não entram em SCOPED_MODELS (evita inject inválido).
  "WhatsappFlowDefinition",
  "DistributionRule",
  "DistributionMember",
  "Segment",
  "Campaign",
  "CampaignRecipient",
  "LossReason",
  "ApiToken",
  "MobileLayoutConfig",
  "UserDashboardLayout",
  "WebPushSubscription",
  "AgentSchedule",
  "AgentStatus",
  "AgentPresenceLog",
  "AIAgentConfig",
  "AIAgentKnowledgeDoc",
  "AIAgentKnowledgeChunk",
  "AIAgentRun",
  "AIAgentMessage",
  "OrganizationInvite",
  // Authz Foundation (Fase 1) — esses 3 modelos sao tenant-scoped.
  // Sem isso, prisma.role.findMany() leakaria roles de OUTROS tenants
  // pra um Admin tentando listar permissoes da propria org.
  "Role",
  "UserRoleAssignment",
  "OrganizationSetting",
]);

type AnyArgs = Record<string, unknown>;

/**
 * Implementacao das helpers (mergeWhere, mergeData, deepInjectOrgId)
 * vive em @/lib/prisma-tenant-helpers — ficou separado pra ser
 * testavel sem precisar de DB rodando. Importadas no topo do arquivo.
 *
 * Doc do deepInjectOrgId: injeta `organizationId` recursivamente em
 * nested writes (`create`, `createMany.data`, `connectOrCreate.create`,
 * `upsert.create/update`, `update.data`). NAO toca em `where`, `connect`,
 * `disconnect`, `set`, `delete`. Se alguma relation apontar pra um
 * model nao-scoped (ex.: User), o Prisma rejeita com "Unknown arg
 * organizationId" — nesse caso o caller deve usar `prismaBase`.
 *
 * Bug-history: a versao "checked input" (`organization: { connect }`)
 * quebrava callsites com FKs escalares (`conversationId`, `contactId`,
 * etc) misturadas. Resolvido voltando pra `organizationId` escalar
 * (unchecked input) — convencao do projeto.
 */

const globalForPrisma = globalThis as unknown as {
  prismaScoped: ReturnType<typeof extend> | undefined;
};

/**
 * Fallback: resolve o ctx diretamente do cookie da request atual quando
 * o handler nao envolveu explicitamente em withOrgContext. Necessario
 * porque `AsyncLocalStorage.enterWith` chamado em `auth()` / helpers so
 * propaga pra DESCENDENTES do frame do wrapper, nao pro caller — e
 * refatorar ~130 route handlers pra usar runWithContext explicito nao eh
 * viavel no escopo atual.
 *
 * Funciona so em request scope do Next.js (next/headers so responde la).
 * Em worker/webhook/cron, retorna null — esses fluxos ja usam
 * `withSystemContext` / `withWebhookContext` / prismaBase.
 *
 * Decode usa a mesma chave que o NextAuth (AUTH_SECRET / NEXTAUTH_SECRET)
 * e o nome-padrao dos cookies do next-auth v5 (authjs.session-token,
 * com prefixo __Secure- quando o cookie foi emitido via HTTPS).
 */
async function resolveCtxFromNextCookie(): Promise<RequestContext | null> {
  try {
    const headersMod = (await import("next/headers")) as {
      cookies: () => Promise<{ get: (n: string) => { value: string } | undefined }>;
    };
    const cookieStore = await headersMod.cookies();

    // Guard: fora de request scope o cookieStore pode ser um objeto
    // inválido sem o método .get (causa "e.get is not a function").
    if (!cookieStore || typeof cookieStore.get !== "function") {
      return null;
    }

    const secureName = "__Secure-authjs.session-token";
    const insecureName = "authjs.session-token";
    const raw =
      cookieStore.get(secureName)?.value ??
      cookieStore.get(insecureName)?.value;
    if (!raw) return null;

    const secret =
      process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
    if (!secret) return null;

    const jwtMod = (await import("@auth/core/jwt")) as {
      decode: (p: {
        token: string;
        secret: string;
        salt: string;
      }) => Promise<Record<string, unknown> | null>;
    };
    // o NextAuth v5 usa o nome do cookie como salt pra derivar a chave
    const cookieName =
      cookieStore.get(secureName)?.value ? secureName : insecureName;
    const decoded = await jwtMod.decode({
      token: raw,
      secret,
      salt: cookieName,
    });
    if (!decoded || typeof decoded.id !== "string") return null;

    return {
      organizationId:
        (decoded.organizationId as string | null | undefined) ?? null,
      userId: decoded.id,
      isSuperAdmin: Boolean(decoded.isSuperAdmin),
    };
  } catch {
    // fora de request scope (worker, cron, etc) ou cookie invalido
    return null;
  }
}

function extend(base: typeof prismaBase = prismaBase) {
  return base.$extends({
    name: "organization-scope",
    query: {
      $allModels: {
        async $allOperations({ args, query, operation, model }) {
          if (!SCOPED_MODELS.has(model as Prisma.ModelName)) {
            return query(args);
          }
          let ctx: RequestContext | undefined = getRequestContext();
          if (!ctx) {
            const resolved = await resolveCtxFromNextCookie();
            if (resolved) {
              enterRequestContext(resolved);
              ctx = resolved;
            }
          }
          if (!ctx) {
            throw new Error(
              `[prisma] ${model}.${operation} chamado fora de RequestContext. ` +
                `Envolva o handler em withOrgContext/withApiAuthContext/withWebhookContext, ` +
                `ou use prismaBase (@/lib/prisma-base) para cross-org.`,
            );
          }
          // super-admin:
          //   - sem organizationId no ctx → bypass total (ex.: painel
          //     /admin/organizations operando cross-org)
          //   - COM organizationId → continua injetando. Motivo: o
          //     admin@eduit.com eh super-admin mas tambem membro da
          //     org EduIT, e ao acessar a UI padrao do CRM (dashboard,
          //     pipelines, etc.) todas as writes precisam sair
          //     escopadas. Bypass nesse caso quebraria `pipeline.create`
          //     (org obrigatoria no schema).
          if (ctx.isSuperAdmin && !ctx.organizationId) {
            return query(args);
          }
          if (!ctx.organizationId) {
            throw new Error(
              `[prisma] ${model}.${operation} exige organizationId mas o contexto esta vazio.`,
            );
          }
          const orgId = ctx.organizationId;
          const a = (args ?? {}) as AnyArgs;

          switch (operation) {
            case "findUnique":
            case "findUniqueOrThrow":
            case "findFirst":
            case "findFirstOrThrow":
            case "findMany":
            case "count":
            case "aggregate":
            case "groupBy":
            case "updateMany":
            case "deleteMany":
            case "update":
            case "delete": {
              a.where = mergeWhere(a.where, orgId);
              if (operation === "update" && a.data) {
                a.data = deepInjectOrgId(a.data, orgId) as Record<
                  string,
                  unknown
                >;
              }
              break;
            }
            case "create": {
              a.data = deepInjectOrgId(a.data, orgId) as Record<
                string,
                unknown
              >;
              break;
            }
            case "createMany":
            case "createManyAndReturn": {
              const raw = a.data;
              if (Array.isArray(raw)) {
                a.data = raw.map(
                  (d) => deepInjectOrgId(d, orgId) as Record<string, unknown>,
                );
              } else if (raw && typeof raw === "object") {
                a.data = deepInjectOrgId(raw, orgId) as Record<
                  string,
                  unknown
                >;
              }
              break;
            }
            case "upsert": {
              a.where = mergeWhere(a.where, orgId);
              if (a.create) {
                a.create = deepInjectOrgId(a.create, orgId) as Record<
                  string,
                  unknown
                >;
              }
              if (a.update) {
                a.update = deepInjectOrgId(a.update, orgId) as Record<
                  string,
                  unknown
                >;
              }
              break;
            }
            default:
              break;
          }
          return query(a);
        },
      },
    },
  });
}

/**
 * Aplica a extension de organization-scope a qualquer base client.
 * Exportado pra ser reaproveitado em `lib/prisma-replica.ts` (PR 5.2)
 * sem duplicar logica.
 */
export const applyOrgScope = extend;

export const prisma = globalForPrisma.prismaScoped ?? extend();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaScoped = prisma;
}

export type ScopedPrisma = typeof prisma;

// NOTA: `prismaReplica` (PR 5.2) NAO eh re-exportado aqui de proposito.
// Re-export criava ciclo `prisma.ts <-> prisma-replica.ts` que, depois
// que o PrismaClient passou a ser tratado como async module pelo
// webpack (chunk 2144 minificado), virava TDZ em "Collecting page
// data" do `next build`:
//   ReferenceError: Cannot access 'o' before initialization
//     at Object.zR (.next/server/chunks/2144.js:1:2302)
// Quem precisa do replica importa diretamente de `@/lib/prisma-replica`
// — o unico caller real eh `lib/analytics.ts::analyticsClient()`.

/**
 * Tipo do cliente dentro de prisma.$transaction((tx) => ...).
 * Por causa do extension, o `tx` nao e mais um Prisma.TransactionClient
 * puro, e sim a versao extendida sem os metodos terminadores. Quem
 * recebe um `tx` em assinatura de funcao deve usar `ScopedTx` em vez
 * de `Prisma.TransactionClient` para evitar TS2345 no callsite.
 */
export type ScopedTx = Omit<
  ScopedPrisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
