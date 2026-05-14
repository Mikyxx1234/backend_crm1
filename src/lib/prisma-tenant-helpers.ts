/**
 * Helpers puros (sem dependencia de Prisma engine) usados pela extension
 * de organization-scope em @/lib/prisma. Extraidos pra modulo separado
 * pra serem testaveis sem precisar de DB rodando.
 *
 * Contrato:
 *   - mergeWhere(existing, orgId) -> sempre retorna objeto com organizationId.
 *     Se ja existir organizationId no existing, NAO sobreescreve (callsite
 *     pode estar fazendo cross-org legitimo via prismaBase, embora isso
 *     nem chegue aqui pq prismaBase nao tem extension).
 *   - mergeData(existing, orgId) -> injeta `organization: { connect: { id } }`
 *     quando o callsite ainda nao colocou organizationId nem organization.
 *   - deepInjectOrgId(value, orgId) -> recursivamente injeta organizationId
 *     em nested writes (create, createMany, connectOrCreate, upsert, update).
 *
 * Pareio identico ao do prisma.ts — qualquer mudanca aqui precisa ser
 * espelhada la, ou (melhor) prisma.ts importa daqui e a unica fonte de
 * verdade vive aqui. Migration completa na proxima refac.
 */

export function mergeWhere(
  existing: unknown,
  orgId: string,
): Record<string, unknown> {
  if (!existing || typeof existing !== "object") {
    return { organizationId: orgId };
  }
  const w = existing as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(w, "organizationId")) {
    return w;
  }
  return { ...w, organizationId: orgId };
}

export function mergeData(
  existing: unknown,
  orgId: string,
): Record<string, unknown> {
  if (!existing || typeof existing !== "object") {
    return { organization: { connect: { id: orgId } } };
  }
  const d = existing as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(d, "organizationId") ||
    Object.prototype.hasOwnProperty.call(d, "organization")
  ) {
    return d;
  }
  return { ...d, organization: { connect: { id: orgId } } };
}

export function deepInjectOrgId(value: unknown, orgId: string): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepInjectOrgId(item, orgId));
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let seenOrgId = false;
  let seenOrganization = false;

  for (const [key, v] of Object.entries(src)) {
    if (key === "organizationId") {
      seenOrgId = true;
      out[key] = v;
      continue;
    }
    if (key === "organization") {
      seenOrganization = true;
      out[key] = v;
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const relW = v as Record<string, unknown>;
      const isRelationWrap =
        "create" in relW ||
        "createMany" in relW ||
        "connectOrCreate" in relW ||
        "upsert" in relW ||
        "update" in relW ||
        "updateMany" in relW;
      if (isRelationWrap) {
        const processed: Record<string, unknown> = { ...relW };
        if (processed.create !== undefined) {
          processed.create = deepInjectOrgId(processed.create, orgId);
        }
        if (
          processed.createMany &&
          typeof processed.createMany === "object"
        ) {
          const cm = { ...(processed.createMany as Record<string, unknown>) };
          if (cm.data !== undefined) {
            cm.data = deepInjectOrgId(cm.data, orgId);
          }
          processed.createMany = cm;
        }
        if (processed.connectOrCreate !== undefined) {
          const apply = (c: unknown): unknown => {
            if (!c || typeof c !== "object") return c;
            const co = { ...(c as Record<string, unknown>) };
            if (co.create !== undefined) {
              co.create = deepInjectOrgId(co.create, orgId);
            }
            return co;
          };
          processed.connectOrCreate = Array.isArray(processed.connectOrCreate)
            ? processed.connectOrCreate.map(apply)
            : apply(processed.connectOrCreate);
        }
        if (processed.upsert !== undefined) {
          const apply = (u: unknown): unknown => {
            if (!u || typeof u !== "object") return u;
            const uo = { ...(u as Record<string, unknown>) };
            if (uo.create !== undefined) {
              uo.create = deepInjectOrgId(uo.create, orgId);
            }
            if (uo.update !== undefined) {
              uo.update = deepInjectOrgId(uo.update, orgId);
            }
            return uo;
          };
          processed.upsert = Array.isArray(processed.upsert)
            ? processed.upsert.map(apply)
            : apply(processed.upsert);
        }
        if (processed.update !== undefined) {
          const apply = (u: unknown): unknown => {
            if (!u || typeof u !== "object") return u;
            const uo = u as Record<string, unknown>;
            if (uo.data !== undefined) {
              return { ...uo, data: deepInjectOrgId(uo.data, orgId) };
            }
            return deepInjectOrgId(uo, orgId);
          };
          processed.update = Array.isArray(processed.update)
            ? processed.update.map(apply)
            : apply(processed.update);
        }
        out[key] = processed;
        continue;
      }
    }
    out[key] = v;
  }
  if (!seenOrgId && !seenOrganization) {
    out.organizationId = orgId;
  }
  return out;
}
