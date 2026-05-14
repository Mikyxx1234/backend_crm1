/**
 * Helpers para call-sites que escrevem em models tenant-scoped (PR 6.1).
 *
 * A extension `applyOrgScope` (em `src/lib/prisma.ts`) injeta
 * `organizationId` em runtime para todas as writes em models scoped.
 * Mas o tipo Prisma exige o campo presente em `*CreateInput` /
 * `*UncheckedCreateInput`, gerando ~143 falsos positivos de TS2322
 * espalhados por ~50 arquivos.
 *
 * `withOrg` resolve isso de forma type-safe e auto-documentada:
 *
 *   ANTES (ts2322 — `organizationId` ausente):
 *     await prisma.contact.create({ data: { name, phone } });
 *
 *   DEPOIS:
 *     await prisma.contact.create({
 *       data: withOrg({ name, phone }, getOrgIdOrThrow()),
 *     });
 *
 * Em call-sites onde o `organizationId` ja vem da extension (chamada
 * dentro de `withOrgContext`/handler autenticado), pode-se usar a
 * forma curta `withOrgFromCtx({ name, phone })` que pega o orgId
 * do `RequestContext` automaticamente.
 *
 * Trade-off vs adicionar `organizationId: orgId` direto no objeto:
 *   - Mesmo runtime — a extension nao re-injeta se ja tem.
 *   - Menos verboso pra manter (helper centralizado, nao espalhado).
 *   - Ajuda code review: `withOrg` deixa claro "essa write e
 *     tenant-scoped" sem ler o resto do arquivo.
 */
import { getRequestContext } from "@/lib/request-context";

/**
 * Adiciona `organizationId` a um payload de create/update Prisma e
 * retorna o tipo esperado pelo Prisma (com organizationId obrigatorio).
 *
 * @param data Payload sem organizationId.
 * @param orgId Organization id explicito.
 * @returns Mesmo objeto + organizationId, tipado corretamente.
 */
export function withOrg<T>(
  data: T,
  orgId: string,
): T & { organizationId: string } {
  return { ...data, organizationId: orgId } as T & { organizationId: string };
}

/**
 * Variante que pega o orgId do RequestContext atual. Usar em
 * handlers autenticados onde `withOrgContext` ja foi aplicado.
 *
 * Throws se nao ha contexto ou orgId — mesma protecao da extension,
 * mas com erro mais cedo (no call-site).
 */
export function withOrgFromCtx<T>(data: T): T & { organizationId: string } {
  const ctx = getRequestContext();
  if (!ctx?.organizationId) {
    throw new Error(
      "[withOrgFromCtx] RequestContext sem organizationId. " +
        "Envolva o handler em withOrgContext ou passe o orgId explicito.",
    );
  }
  return { ...data, organizationId: ctx.organizationId } as T & {
    organizationId: string;
  };
}

/**
 * Variante para `createMany`: aplica `withOrg` em cada item.
 */
export function withOrgMany<T>(
  data: readonly T[],
  orgId: string,
): Array<T & { organizationId: string }> {
  return data.map((item) => withOrg(item, orgId));
}
