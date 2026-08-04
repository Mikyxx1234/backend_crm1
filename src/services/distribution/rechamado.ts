/**
 * Métricas de rechamado para o Cockpit do Agente.
 *
 * Três faixas (mesmo telefone/contato, janela de 24h):
 *  1. Recontato 24h — voltou; assunto/depto irrelevante
 *  2. Rechamado (mesmo depto) — recontato + mesmo departmentId
 *  3. Recontato cruzado — recontato + depto diferente (ou sem depto em um dos lados)
 *
 * Base: DistributionLog sucesso (inclui handoff do agente e redistribuições).
 */

import { prisma } from "@/lib/prisma";

const MS_24H = 24 * 60 * 60 * 1000;

export type RechamadoBand = "recontato" | "mesmo_depto" | "cruzado";

export interface RechamadoSample {
  contactId: string;
  phone: string | null;
  name: string | null;
  band: "mesmo_depto" | "cruzado";
  fromDepartmentId: string | null;
  fromDepartmentName: string | null;
  toDepartmentId: string | null;
  toDepartmentName: string | null;
  priorAt: string;
  currentAt: string;
  conversationId: string | null;
}

export interface RechamadoDeptRow {
  departmentId: string | null;
  departmentName: string;
  recontato: number;
  mesmoDepto: number;
  cruzado: number;
}

export interface RechamadoRouteRow {
  from: string;
  to: string;
  count: number;
}

export interface RechamadoMetrics {
  /** Janela: meia-noite SP de hoje → agora (eventos de retorno "hoje"). */
  since: string;
  windowHours: 24;
  totals: {
    /** Eventos de retorno hoje (2ª+ distribuição em 24h). */
    recontato: number;
    mesmoDepto: number;
    cruzado: number;
    /** Contatos distintos com pelo menos 1 recontato hoje. */
    uniqueContacts: number;
  };
  /** Destino da redistribuição (departamento atual). */
  byDepartment: RechamadoDeptRow[];
  /** Principais rotas origem → destino. */
  topRoutes: RechamadoRouteRow[];
  /** Últimos casos (amostra curta no cockpit). */
  samples: RechamadoSample[];
}

type LogRow = {
  id: string;
  contactId: string | null;
  conversationId: string | null;
  departmentId: string | null;
  createdAt: Date;
};

function classifyBand(
  priorDept: string | null,
  currentDept: string | null,
): "mesmo_depto" | "cruzado" {
  if (priorDept && currentDept && priorDept === currentDept) {
    return "mesmo_depto";
  }
  return "cruzado";
}

/**
 * Calcula rechamados cujos eventos de retorno ocorreram a partir de `since`
 * (tipicamente meia-noite SP de hoje).
 */
export async function getRechamadoMetrics(args: {
  organizationId: string;
  since: Date;
  now?: Date;
  sampleLimit?: number;
}): Promise<RechamadoMetrics> {
  const now = args.now ?? new Date();
  const sampleLimit = args.sampleLimit ?? 8;
  const lookbackStart = new Date(args.since.getTime() - MS_24H);

  const logs = await prisma.distributionLog.findMany({
    where: {
      organizationId: args.organizationId,
      success: true,
      contactId: { not: null },
      createdAt: { gte: lookbackStart, lte: now },
    },
    select: {
      id: true,
      contactId: true,
      conversationId: true,
      departmentId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byContact = new Map<string, LogRow[]>();
  for (const row of logs) {
    if (!row.contactId) continue;
    const arr = byContact.get(row.contactId) ?? [];
    arr.push(row);
    byContact.set(row.contactId, arr);
  }

  let recontato = 0;
  let mesmoDepto = 0;
  let cruzado = 0;
  const unique = new Set<string>();
  const hits: Array<{
    contactId: string;
    band: "mesmo_depto" | "cruzado";
    prior: LogRow;
    current: LogRow;
  }> = [];

  for (const [contactId, rows] of byContact) {
    for (let i = 0; i < rows.length; i++) {
      const current = rows[i]!;
      if (current.createdAt < args.since) continue;

      // Prior mais recente dentro de 24h antes deste evento.
      let prior: LogRow | null = null;
      const earliest = current.createdAt.getTime() - MS_24H;
      for (let j = i - 1; j >= 0; j--) {
        const cand = rows[j]!;
        if (cand.createdAt.getTime() < earliest) break;
        prior = cand;
        break;
      }
      if (!prior) continue;

      // Evita contar redistribuição imediata do mesmo log/tentativa (< 2 min).
      if (current.createdAt.getTime() - prior.createdAt.getTime() < 2 * 60 * 1000) {
        continue;
      }

      const band = classifyBand(prior.departmentId, current.departmentId);
      recontato++;
      unique.add(contactId);
      if (band === "mesmo_depto") mesmoDepto++;
      else cruzado++;
      hits.push({ contactId, band, prior, current });
    }
  }

  hits.sort(
    (a, b) => b.current.createdAt.getTime() - a.current.createdAt.getTime(),
  );
  const sampleHits = hits.slice(0, sampleLimit);

  const contactIds = [...new Set(sampleHits.map((h) => h.contactId))];
  const deptIds = [
    ...new Set(
      hits.flatMap((h) =>
        [h.prior.departmentId, h.current.departmentId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ),
  ];

  const [contacts, departments] = await Promise.all([
    contactIds.length
      ? prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true, phone: true },
        })
      : Promise.resolve([]),
    deptIds.length
      ? prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const deptLabel = (id: string | null) =>
    id ? (deptMap.get(id) ?? "—") : "—";

  const byDeptMap = new Map<
    string,
    {
      departmentId: string | null;
      recontato: number;
      mesmoDepto: number;
      cruzado: number;
    }
  >();
  const routeMap = new Map<string, number>();
  for (const h of hits) {
    const key = h.current.departmentId ?? "__none__";
    const row = byDeptMap.get(key) ?? {
      departmentId: h.current.departmentId,
      recontato: 0,
      mesmoDepto: 0,
      cruzado: 0,
    };
    row.recontato++;
    if (h.band === "mesmo_depto") row.mesmoDepto++;
    else row.cruzado++;
    byDeptMap.set(key, row);

    const rk = `${deptLabel(h.prior.departmentId)}→${deptLabel(h.current.departmentId)}`;
    routeMap.set(rk, (routeMap.get(rk) ?? 0) + 1);
  }

  const byDepartment: RechamadoDeptRow[] = [...byDeptMap.entries()]
    .map(([, v]) => ({
      departmentId: v.departmentId,
      departmentName: deptLabel(v.departmentId),
      recontato: v.recontato,
      mesmoDepto: v.mesmoDepto,
      cruzado: v.cruzado,
    }))
    .sort((a, b) => b.recontato - a.recontato);

  const topRoutes: RechamadoRouteRow[] = [...routeMap.entries()]
    .map(([k, count]) => {
      const [from, to] = k.split("→");
      return { from: from || "—", to: to || "—", count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const samples: RechamadoSample[] = sampleHits.map((h) => {
    const c = contactMap.get(h.contactId);
    return {
      contactId: h.contactId,
      phone: c?.phone ?? null,
      name: c?.name ?? null,
      band: h.band,
      fromDepartmentId: h.prior.departmentId,
      fromDepartmentName: h.prior.departmentId
        ? (deptMap.get(h.prior.departmentId) ?? null)
        : null,
      toDepartmentId: h.current.departmentId,
      toDepartmentName: h.current.departmentId
        ? (deptMap.get(h.current.departmentId) ?? null)
        : null,
      priorAt: h.prior.createdAt.toISOString(),
      currentAt: h.current.createdAt.toISOString(),
      conversationId: h.current.conversationId,
    };
  });

  return {
    since: args.since.toISOString(),
    windowHours: 24,
    totals: {
      recontato,
      mesmoDepto,
      cruzado,
      uniqueContacts: unique.size,
    },
    byDepartment,
    topRoutes,
    samples,
  };
}
