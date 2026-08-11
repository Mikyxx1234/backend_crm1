/**
 * Recuperação lexical dos modelos internos do CRM (`MessageTemplate`)
 * para enriquecer o prompt do agente ATENDIMENTO.
 *
 * Não envia o texto integral ao aluno — só injeta referência no system
 * prompt. Modelos de cancelamento/trancamento/retenção/transferência
 * são excluídos (handoff de Retenção continua nas regras do agente).
 */

import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

export type RetrievedMessageModel = {
  id: string;
  name: string;
  content: string;
  score: number;
};

/** Títulos/conteúdos sensíveis — nunca entram no contexto do agente. */
export const MESSAGE_MODEL_EXCLUDE_RE =
  /cancel|tranc|desist|reten|transfer[eê]ncia|transferencia/i;

const STOP = new Set([
  "o",
  "a",
  "os",
  "as",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "um",
  "uma",
  "meu",
  "minha",
  "me",
  "eu",
  "para",
  "por",
  "com",
  "que",
  "nao",
  "se",
  "sua",
  "seu",
  "ja",
  "esta",
  "estou",
  "preciso",
  "quero",
  "como",
  "esse",
  "essa",
  "isso",
  "the",
  "app",
  "msg",
  "pra",
]);

const MAX_CONTENT_CHARS = 700;
/** Score mínimo para injetar (evita falso positivo fraco). */
const MIN_SCORE = 2.5;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeForModelMatch(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export function isExcludedMessageModel(parts: {
  name: string;
  content: string;
  category?: string | null;
}): boolean {
  return MESSAGE_MODEL_EXCLUDE_RE.test(
    `${parts.name}\n${parts.content}\n${parts.category ?? ""}`,
  );
}

/** Score lexical: overlap + boost no título. */
export function scoreMessageModelMatch(
  query: string,
  model: { name: string; content: string; category?: string | null },
): number {
  const qt = new Set(tokenizeForModelMatch(query));
  if (qt.size === 0) return 0;
  const titleTok = new Set(tokenizeForModelMatch(model.name));
  const bodyTok = new Set([
    ...tokenizeForModelMatch(model.content.slice(0, 1200)),
    ...tokenizeForModelMatch(model.category ?? ""),
  ]);
  let bodyHits = 0;
  let titleHits = 0;
  for (const t of qt) {
    if (titleTok.has(t)) titleHits++;
    if (bodyTok.has(t)) bodyHits++;
  }
  return bodyHits + titleHits * 1.5;
}

function truncateContent(content: string): string {
  const t = content.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_CONTENT_CHARS) return t;
  return `${t.slice(0, MAX_CONTENT_CHARS - 1)}…`;
}

/**
 * Busca até `topK` modelos internos relevantes à mensagem do aluno.
 * Escopo multi-tenant via Prisma extension + organizationId explícito.
 */
export async function retrieveRelevantMessageModels(
  query: string,
  topK = 3,
): Promise<RetrievedMessageModel[]> {
  const q = query.trim();
  if (!q) return [];

  const orgId = getOrgIdOrThrow();

  const rows = await prisma.messageTemplate.findMany({
    where: {
      organizationId: orgId,
      status: { not: "REJECTED" },
      content: { not: "" },
    },
    select: {
      id: true,
      name: true,
      content: true,
      category: true,
    },
    take: 300,
  });

  const scored: RetrievedMessageModel[] = [];
  for (const r of rows) {
    if (isExcludedMessageModel(r)) continue;
    const score = scoreMessageModelMatch(q, r);
    if (score < MIN_SCORE) continue;
    scored.push({
      id: r.id,
      name: r.name,
      content: truncateContent(r.content),
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export function formatMessageModelsBlock(
  models: RetrievedMessageModel[],
): string {
  if (models.length === 0) return "";
  const sections = models
    .map((m, i) => `[M${i + 1}] ${m.name}\n${m.content}`)
    .join("\n\n---\n\n");
  return [
    "",
    "MODELOS INTERNOS DE REFERÊNCIA (procedimentos operacionais do time):",
    "- Use como FONTE da verdade para passos/links. Parafraseie em 1–3 frases curtas no WhatsApp.",
    "- NÃO copie o texto integral do modelo nem envie blocos longos com muitos passos numerados.",
    "- NUNCA use (nem parafraseie) modelos de cancelamento/trancamento/desistência/retenção/transferência — nesses casos transfira para Retenção com as tools.",
    "- Se o modelo cobrir o assunto, tende a confiança ALTA (0.8+).",
    sections,
  ].join("\n");
}
