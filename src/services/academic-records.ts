/**
 * Dados acadêmicos de alunos (piloto "matriculados").
 *
 * Origem: relatório Excel/CSV subido manualmente pela org na aba
 * "Dados dos alunos" (Agentes de IA). Cada linha do relatório vira um
 * `StudentAcademicRecord` — um aluno pode ter várias linhas (cursos/ciclos).
 *
 * A tool `consultar_matricula` do agente lê esses dados casando por
 * telefone, e-mail ou CPF do contato em conversa, para responder de forma
 * personalizada (situação da matrícula, curso, polo, etc.).
 *
 * Escopo multi-tenant: estes modelos NÃO passam pela Prisma Extension —
 * TODAS as queries filtram `organizationId` explicitamente.
 */

import type { Prisma } from "@prisma/client";

import { readTableFromBuffer } from "@/lib/import-helpers";
import { prisma } from "@/lib/prisma";

// ── Normalizadores ─────────────────────────────────────────────

function onlyDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** CPF canônico: 11 dígitos com zero à esquerda. `null` se vazio/ inválido. */
export function normalizeCpf(v: unknown): string | null {
  const d = onlyDigits(v);
  if (!d) return null;
  if (d.length > 11) return d.slice(-11);
  return d.padStart(11, "0");
}

/**
 * Telefone canônico p/ casamento: remove DDI 55 quando presente e mantém os
 * últimos 11 dígitos (DDD + celular). Ex.: "+55 (11) 98774-2444" -> "11987742444".
 */
export function canonicalPhone(v: unknown): string | null {
  let d = onlyDigits(v);
  if (!d) return null;
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length > 11) d = d.slice(-11);
  return d || null;
}

function normEmail(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s.includes("@") ? s : null;
}

function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** Tenta interpretar a data da matrícula em vários formatos. `null` se falhar. */
function parseDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // ISO / yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  // dd/mm/yyyy ou mm/dd/yyyy (assume dd/mm — padrão BR)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    let year = +y;
    if (year < 100) year += 2000;
    const day = +a;
    const month = +b;
    // Se o "dia" > 12, com certeza é dd/mm; senão assume dd/mm (BR).
    const d = new Date(Date.UTC(year, month - 1, day));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ── Mapeamento de colunas do relatório ─────────────────────────
//
// `readTableFromBuffer` normaliza os headers para minúsculas + underscore,
// MAS preserva acentos. Aqui reindexamos a linha por chave sem acento para
// tolerar variações ("situação_matrícula" -> "situacao_matricula").

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function reindexRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[deaccent(k)] = v;
  return out;
}

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

type ParsedRecord = Omit<Prisma.StudentAcademicRecordCreateManyInput, "organizationId">;

function mapRow(rawRow: Record<string, string>): ParsedRecord | null {
  const row = reindexRow(rawRow);
  const nome = pick(row, "nome", "aluno", "nome_aluno");
  const cpf = normalizeCpf(pick(row, "cpf"));
  const phone = canonicalPhone(pick(row, "fone_celular", "celular", "telefone", "fone"));
  const email = normEmail(pick(row, "email"));
  // Linha sem nenhum identificador útil é descartada.
  if (!nome && !cpf && !phone && !email) return null;

  return {
    cpf,
    rgm: str(pick(row, "rgm")),
    nome: nome || "(sem nome)",
    curso: str(pick(row, "curso", "curso_limpo")),
    serie: str(pick(row, "serie")),
    polo: str(pick(row, "polo", "polo_aulas")),
    ciclo: str(pick(row, "ciclo")),
    instituicao: str(pick(row, "instituicao")),
    situacao: str(pick(row, "situacao_matricula", "situacao")),
    tipoMatricula: str(pick(row, "tipo_matricula")),
    dataMatricula: parseDate(pick(row, "data_matricula")),
    dataNascimento: str(pick(row, "data_nascimento", "data_nasc")),
    email,
    emailAcademico: normEmail(pick(row, "email_academico", "email_ad")),
    phone,
    raw: rawRow as Prisma.InputJsonValue,
  };
}

// ── Import (replace) ───────────────────────────────────────────

export type ImportResult = {
  totalRows: number;
  skipped: number;
};

/**
 * Substitui TODOS os registros acadêmicos da org pelos do arquivo (replace
 * completo — o relatório é a fonte da verdade do dia). Grava histórico.
 */
export async function importMatriculados(params: {
  organizationId: string;
  buffer: Buffer;
  fileName: string;
  uploadedById?: string | null;
}): Promise<ImportResult> {
  const { organizationId, buffer, fileName, uploadedById } = params;

  const { rows } = await readTableFromBuffer(buffer, fileName);
  const parsed: ParsedRecord[] = [];
  let skipped = 0;
  for (const r of rows) {
    const rec = mapRow(r);
    if (rec) parsed.push(rec);
    else skipped++;
  }

  const data: Prisma.StudentAcademicRecordCreateManyInput[] = parsed.map((p) => ({
    ...p,
    organizationId,
  }));

  const CHUNK = 1000;
  await prisma.$transaction(async (tx) => {
    await tx.studentAcademicRecord.deleteMany({ where: { organizationId } });
    for (let i = 0; i < data.length; i += CHUNK) {
      await tx.studentAcademicRecord.createMany({ data: data.slice(i, i + CHUNK) });
    }
    await tx.academicImportHistory.create({
      data: {
        organizationId,
        reportType: "matriculados",
        fileName,
        totalRows: data.length,
        uploadedById: uploadedById ?? null,
      },
    });
  });

  return { totalRows: data.length, skipped };
}

// ── Lookup ─────────────────────────────────────────────────────

/** Prioriza registros ativos ("EM CURSO") e matrícula mais recente. */
function sortRecords<T extends { situacao: string | null; dataMatricula: Date | null }>(
  recs: T[],
): T[] {
  const rank = (s: string | null) => {
    const v = (s ?? "").toUpperCase();
    if (v.includes("EM CURSO") || v.includes("ATIVO") || v.includes("CURSANDO")) return 0;
    if (v.includes("TRANC")) return 1;
    if (v.includes("CANCEL") || v.includes("EVAS") || v.includes("DESIST")) return 3;
    return 2;
  };
  return [...recs].sort((a, b) => {
    const r = rank(a.situacao) - rank(b.situacao);
    if (r !== 0) return r;
    const da = a.dataMatricula?.getTime() ?? 0;
    const db = b.dataMatricula?.getTime() ?? 0;
    return db - da;
  });
}

export type StudentLookup = {
  phone?: string | null;
  email?: string | null;
  cpf?: string | null;
};

/**
 * Busca registros acadêmicos por identidade do contato. Tenta, nesta ordem:
 * CPF -> telefone -> e-mail. Retorna TODAS as linhas do aluno (cursos/ciclos)
 * ordenadas por relevância. Vazio se não achar.
 */
export async function lookupStudent(
  organizationId: string,
  id: StudentLookup,
): Promise<Awaited<ReturnType<typeof prisma.studentAcademicRecord.findMany>>> {
  const cpf = normalizeCpf(id.cpf);
  if (cpf) {
    const byCpf = await prisma.studentAcademicRecord.findMany({
      where: { organizationId, cpf },
    });
    if (byCpf.length) return sortRecords(byCpf);
  }

  const phone = canonicalPhone(id.phone);
  if (phone) {
    let byPhone = await prisma.studentAcademicRecord.findMany({
      where: { organizationId, phone },
    });
    // Fallback: casa pelos últimos 8 dígitos (variações de 9º dígito/DDI).
    if (!byPhone.length && phone.length >= 8) {
      const suffix = phone.slice(-8);
      byPhone = await prisma.studentAcademicRecord.findMany({
        where: { organizationId, phone: { endsWith: suffix } },
      });
    }
    if (byPhone.length) return sortRecords(byPhone);
  }

  const email = normEmail(id.email);
  if (email) {
    const byEmail = await prisma.studentAcademicRecord.findMany({
      where: {
        organizationId,
        OR: [{ email }, { emailAcademico: email }],
      },
    });
    if (byEmail.length) return sortRecords(byEmail);
  }

  return [];
}

// ── Histórico ──────────────────────────────────────────────────

export async function getImportHistory(organizationId: string, limit = 20) {
  return prisma.academicImportHistory.findMany({
    where: { organizationId },
    orderBy: { importedAt: "desc" },
    take: limit,
  });
}

export async function getRecordCount(organizationId: string): Promise<number> {
  return prisma.studentAcademicRecord.count({ where: { organizationId } });
}
