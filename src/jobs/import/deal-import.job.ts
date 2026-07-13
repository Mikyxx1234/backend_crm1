import { randomUUID } from "node:crypto";

import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";

import { buildCustomFieldHeaderMap } from "@/lib/contact-import-core";
import {
  DEAL_RESERVED_HEADERS,
  parseDealExpectedClose,
  parseDealValue,
  pickRowExternalId,
  resolveImportModeFlags,
  validateDealImportHeaders,
} from "@/lib/deal-import-core";
import {
  attachTagToDeal,
  readTableFromBuffer,
  upsertImportTag,
} from "@/lib/import-helpers";
import { getLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { readStoredFile } from "@/lib/storage/local";
import type { DealImportPayload } from "@/lib/queue";
import { createContact, updateContact, findContactIdByPhone } from "@/services/contacts";
import {
  getCustomFields,
  upsertDealCustomFieldValues,
} from "@/services/custom-fields";
import { isValidDealStatus, updateDeal } from "@/services/deals";

import {
  incrementOperationProgress,
  markOperationFailed,
  markOperationFinished,
  markOperationStarted,
  type BulkOperationErrorEntry,
} from "@/jobs/leads/_update-progress";

const log = getLogger("worker.etl.deal-import");

/**
 * Linhas por lote. Cada lote de CRIAÇÃO faz ~3 queries (createMany de negócios
 * + createMany de custom fields + createMany de tags), independente do tamanho
 * do lote — é isso que permite importar 10k+ linhas em segundos.
 */
const CHUNK_SIZE = 500;

type ResolvedRow = {
  rowNumber: number;
  title: string;
  stageId: string | null;
  value: number | undefined;
  status: string | undefined;
  expectedClose: Date | undefined;
  lostReason: string | undefined;
  externalId: string | null;
  ownerId: string | undefined;
  contactId: string | undefined;
  customFields: { fieldId: string; value: string }[];
  /** Se casou com um negócio existente (para modo update/upsert). */
  existingId: string | null;
};

/**
 * Handler do job `deal-import`. Processa o arquivo em LOTE:
 *   - pré-carrega estágios/responsáveis/external_ids existentes (poucas queries);
 *   - resolve cada linha em memória;
 *   - insere negócios novos com `createMany` (id gerado no app), depois grava
 *     custom fields e tags também em lote;
 *   - atualizações (modo update/upsert) vão por linha (menos frequentes).
 */
export async function processDealImport(
  payload: DealImportPayload,
  job: Job<DealImportPayload>,
): Promise<void> {
  const { operationId, organizationId, fileName, originalName, importMode } =
    payload;
  const ctx = log.child({ operationId, organizationId, jobId: job.id });

  await markOperationStarted(operationId, organizationId);

  const { allowCreate, allowUpdate } = resolveImportModeFlags(importMode, true);

  // 1. Conteúdo do arquivo (base64 embutido no BulkOperation → fallback disco).
  let fileBuffer: Buffer | null = null;
  try {
    const op = await prismaBase.bulkOperation.findUnique({
      where: { id: operationId },
      select: { payload: true },
    });
    const opPayload = (op?.payload ?? null) as { fileContentB64?: unknown } | null;
    const b64 =
      typeof opPayload?.fileContentB64 === "string" ? opPayload.fileContentB64 : null;
    if (b64) fileBuffer = Buffer.from(b64, "base64");
  } catch (err) {
    ctx.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Falha ao ler conteúdo embutido — tentando storage em disco",
    );
  }
  if (!fileBuffer) {
    const stored = await readStoredFile(organizationId, "imports", fileName);
    if (stored) fileBuffer = stored.buffer;
  }
  if (!fileBuffer) {
    await markOperationFailed(
      operationId,
      organizationId,
      `Conteúdo da importação não encontrado (imports/${fileName}).`,
    );
    return;
  }

  // 2. Parse.
  let headers: string[];
  let rows: Record<string, string>[];
  try {
    const parsed = await readTableFromBuffer(fileBuffer, originalName, payload.delimiter);
    headers = parsed.headers;
    rows = parsed.rows;
  } catch (err) {
    await markOperationFailed(
      operationId,
      organizationId,
      `Falha ao ler o arquivo: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const headerError = validateDealImportHeaders(headers, allowCreate);
  if (headerError) {
    await markOperationFailed(operationId, organizationId, headerError);
    return;
  }

  // 3. Tag opcional (uma vez).
  let importTagId: string | null = null;
  if (payload.tagName) {
    try {
      importTagId = await upsertImportTag(getOrgIdOrThrow(), payload.tagName);
    } catch {
      importTagId = null;
    }
  }

  // 4. Mapa de campos personalizados (colunas → CustomField.id).
  let customFieldMap: Map<string, string> | undefined;
  try {
    const defs = (await getCustomFields("deal")) as Array<{
      id: string;
      name: string;
      label?: string | null;
    }>;
    const map = buildCustomFieldHeaderMap(headers, defs, DEAL_RESERVED_HEADERS);
    if (map.size > 0) customFieldMap = map;
  } catch {
    customFieldMap = undefined;
  }

  // 5. Pré-carga para dedupe/atualização: mapa external_id → dealId da org.
  const externalIdToDealId = new Map<string, string>();
  try {
    const existing = await prisma.deal.findMany({
      where: { externalId: { not: null } },
      select: { id: true, externalId: true },
    });
    for (const d of existing) {
      if (d.externalId) externalIdToDealId.set(d.externalId, d.id);
    }
  } catch (err) {
    ctx.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Falha ao pré-carregar external_ids — dedupe por external_id ficará limitado",
    );
  }

  const stageCache = new Map<string, string | null>();
  const ownerCache = new Map<string, string | undefined>();
  const stageNextPosition = new Map<string, number>();

  // ── Contadores de progresso (flush por chunk) ──────────────────────────
  let chunkProcessed = 0;
  let chunkSucceeded = 0;
  let chunkFailed = 0;
  let chunkErrors: BulkOperationErrorEntry[] = [];

  const flush = async () => {
    if (chunkProcessed === 0) return;
    await incrementOperationProgress(
      operationId,
      organizationId,
      { processed: chunkProcessed, succeeded: chunkSucceeded, failed: chunkFailed },
      chunkErrors,
    );
    chunkProcessed = 0;
    chunkSucceeded = 0;
    chunkFailed = 0;
    chunkErrors = [];
  };

  const pushError = (rowNumber: number, message: string) => {
    chunkFailed += 1;
    chunkErrors.push({
      itemId: `row-${rowNumber}`,
      message: message.slice(0, 500),
      attempt: job.attemptsMade + 1,
      at: new Date().toISOString(),
    });
  };

  // 6. Processa em lotes.
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);

    // 6a. Resolve cada linha (queries pontuais com cache).
    const resolvedForCreate: ResolvedRow[] = [];
    const toUpdate: ResolvedRow[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j];
      const rowNumber = start + j + 2; // +1 cabeçalho, +1 base-1

      const title = row.title?.trim();
      if (!title) {
        chunkProcessed += 1;
        pushError(rowNumber, "Título vazio.");
        continue;
      }

      const statusRaw = row.status?.trim()?.toUpperCase();
      if (statusRaw && !isValidDealStatus(statusRaw)) {
        chunkProcessed += 1;
        pushError(rowNumber, "status inválido (OPEN, WON, LOST).");
        continue;
      }

      const value = parseDealValue(row.value);
      if (value === null) {
        chunkProcessed += 1;
        pushError(rowNumber, "value inválido.");
        continue;
      }

      const expectedClose = parseDealExpectedClose(
        row.expected_close ?? row.expectedclose,
      );
      if (expectedClose === null) {
        chunkProcessed += 1;
        pushError(rowNumber, "expected_close inválido.");
        continue;
      }

      let stageId: string | null;
      let ownerId: string | undefined;
      let contactId: string | undefined;
      try {
        stageId = await resolveStageId(row, stageCache);
        ownerId = await resolveOwnerId(row, ownerCache);
        contactId = await resolveContactId(row, allowUpdate);
      } catch (err) {
        chunkProcessed += 1;
        pushError(
          rowNumber,
          err instanceof Error ? err.message : "Erro ao resolver linha.",
        );
        continue;
      }

      const externalId = pickRowExternalId(row);
      const customFields: { fieldId: string; value: string }[] = [];
      if (customFieldMap) {
        for (const [header, fieldId] of customFieldMap) {
          const raw = row[header]?.trim();
          if (raw) customFields.push({ fieldId, value: raw });
        }
      }

      // Dedupe: id interno > deal_number > external_id (mapa pré-carregado).
      let existingId: string | null = null;
      const rowId = row.id?.trim();
      const numRaw = row.deal_number?.trim();
      if (rowId) {
        const d = await prisma.deal.findUnique({ where: { id: rowId }, select: { id: true } });
        if (d) existingId = d.id;
      }
      if (!existingId && numRaw && /^\d+$/.test(numRaw)) {
        const d = await prisma.deal.findUnique({
          where: {
            organizationId_number: {
              organizationId,
              number: parseInt(numRaw, 10),
            },
          },
          select: { id: true },
        });
        if (d) existingId = d.id;
      }
      if (!existingId && externalId && externalIdToDealId.has(externalId)) {
        existingId = externalIdToDealId.get(externalId)!;
      }

      const resolved: ResolvedRow = {
        rowNumber,
        title,
        stageId,
        value: value ?? undefined,
        status: statusRaw && isValidDealStatus(statusRaw) ? statusRaw : undefined,
        expectedClose: expectedClose ?? undefined,
        lostReason: row.lost_reason?.trim() || row.lostreason?.trim() || undefined,
        externalId,
        ownerId,
        contactId,
        customFields,
        existingId,
      };

      if (existingId) {
        // Já existe. Modo "create" (só novos) → ignora.
        if (!allowUpdate) {
          chunkProcessed += 1;
          chunkSucceeded += 1;
          if (importTagId) {
            try {
              await attachTagToDeal(existingId, importTagId);
            } catch {
              /* tag é best-effort */
            }
          }
          continue;
        }
        toUpdate.push(resolved);
      } else {
        // Não existe. Modo "update" (só atualizar) → ignora.
        if (!allowCreate) {
          chunkProcessed += 1;
          chunkSucceeded += 1;
          continue;
        }
        if (!resolved.stageId) {
          chunkProcessed += 1;
          pushError(
            rowNumber,
            "Estágio não encontrado (stage_id ou pipeline+estágio) — obrigatório para criar.",
          );
          continue;
        }
        resolvedForCreate.push(resolved);
      }
    }

    // 6b. CRIAÇÃO em lote.
    if (resolvedForCreate.length > 0) {
      try {
        const createdIds = await bulkCreateDeals(
          organizationId,
          resolvedForCreate,
          stageNextPosition,
          importTagId,
        );
        // Registra external_ids recém-criados para dedupe intra-arquivo.
        for (const r of resolvedForCreate) {
          if (r.externalId) {
            const id = createdIds.get(r.rowNumber);
            if (id) externalIdToDealId.set(r.externalId, id);
          }
        }
        chunkProcessed += resolvedForCreate.length;
        chunkSucceeded += resolvedForCreate.length;
      } catch (err) {
        // Falha do lote inteiro (ex.: colisão de number concorrente): marca as
        // linhas do lote como falhas — não derruba o restante do arquivo.
        ctx.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Falha ao criar lote de negócios",
        );
        chunkProcessed += resolvedForCreate.length;
        for (const r of resolvedForCreate) {
          pushError(
            r.rowNumber,
            err instanceof Error ? err.message : "Falha ao criar negócio.",
          );
        }
      }
    }

    // 6c. ATUALIZAÇÕES por linha.
    for (const r of toUpdate) {
      chunkProcessed += 1;
      try {
        await updateDeal(r.existingId!, {
          title: r.title,
          ...(r.stageId ? { stageId: r.stageId } : {}),
          ...(r.value !== undefined ? { value: r.value } : {}),
          ...(r.status ? { status: r.status as never } : {}),
          ...(r.expectedClose !== undefined ? { expectedClose: r.expectedClose } : {}),
          ...(r.lostReason !== undefined ? { lostReason: r.lostReason } : {}),
          ...(r.contactId !== undefined ? { contactId: r.contactId } : {}),
          ...(r.ownerId !== undefined ? { ownerId: r.ownerId } : {}),
          ...(r.externalId !== null ? { externalId: r.externalId } : {}),
        });
        if (r.customFields.length > 0) {
          await upsertDealCustomFieldValues(r.existingId!, r.customFields);
        }
        if (importTagId) await attachTagToDeal(r.existingId!, importTagId);
        chunkSucceeded += 1;
      } catch (err) {
        pushError(
          r.rowNumber,
          err instanceof Error ? err.message : "Falha ao atualizar negócio.",
        );
      }
    }

    await flush();
  }

  await markOperationFinished(operationId, organizationId);
  ctx.info({ totalRows: rows.length }, "Importação de negócios concluída");
}

// ── Resolvers (com cache por importação) ───────────────────────────────────

async function resolveStageId(
  row: Record<string, string>,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const sid = row.stage_id?.trim() || row.stageid?.trim();
  const pn = row.pipeline_name?.trim() || row.pipeline?.trim();
  const sn = row.stage_name?.trim() || row.stage?.trim();

  const key = `${sid ?? ""}|${pn ?? ""}|${sn ?? ""}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  let resolved: string | null = null;
  if (sid) {
    const s = await prisma.stage.findUnique({ where: { id: sid }, select: { id: true } });
    resolved = s?.id ?? null;
  } else if (pn && sn) {
    const stage = await prisma.stage.findFirst({
      where: {
        name: { equals: sn, mode: "insensitive" },
        pipeline: { name: { equals: pn, mode: "insensitive" } },
      },
      select: { id: true },
    });
    resolved = stage?.id ?? null;
  }
  cache.set(key, resolved);
  return resolved;
}

async function resolveOwnerId(
  row: Record<string, string>,
  cache: Map<string, string | undefined>,
): Promise<string | undefined> {
  const id = row.owner_id?.trim() || row.ownertoid?.trim();
  if (id) return id;
  const emailRaw = row.owner_email?.trim() || row.owneremail?.trim();
  if (!emailRaw) return undefined;
  const key = emailRaw.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const u = await prisma.user.findFirst({
    where: { email: { equals: key, mode: "insensitive" } },
    select: { id: true },
  });
  cache.set(key, u?.id);
  return u?.id;
}

/**
 * Resolve o contato do negócio. Curto-circuita SEM query quando a linha não
 * traz nenhum dado de contato (caso comum de relatório de matriculados só com
 * título + campos personalizados) — preserva o caminho rápido do lote.
 */
async function resolveContactId(
  row: Record<string, string>,
  updateExisting: boolean,
): Promise<string | undefined> {
  const contactName =
    row.contact_name?.trim() || row.contactname?.trim() || row.contact?.trim() || "";
  const contactEmail = row.contact_email?.trim() || row.contactemail?.trim() || "";
  const contactPhone = row.contact_phone?.trim() || row.contactphone?.trim() || "";
  const cid = row.contact_id?.trim() || row.contactid?.trim();
  const ext =
    row.contact_external_id?.trim() ||
    row.contact_externalid?.trim() ||
    row.kommo_contact_id?.trim();

  if (!cid && !ext && !contactName && !contactEmail && !contactPhone) {
    return undefined;
  }

  const syncContactFields = async (id: string) => {
    if (!updateExisting) return;
    const patch: Record<string, string> = {};
    if (contactName) patch.name = contactName;
    if (contactEmail) patch.email = contactEmail;
    if (contactPhone) patch.phone = contactPhone;
    if (Object.keys(patch).length === 0) return;
    try {
      await updateContact(id, patch);
    } catch {
      /* atualização opcional do contato não deve derrubar o link */
    }
  };

  if (cid) {
    const c = await prisma.contact.findUnique({ where: { id: cid }, select: { id: true } });
    if (c) {
      await syncContactFields(c.id);
      return c.id;
    }
  }

  if (ext) {
    const orgId = getOrgIdOrThrow();
    const found = await prisma.contact.findUnique({
      where: { organizationId_externalId: { organizationId: orgId, externalId: ext } },
      select: { id: true },
    });
    if (found) {
      await syncContactFields(found.id);
      return found.id;
    }
    const created = await createContact({
      name: contactName || `Contato ${ext}`,
      ...(contactEmail ? { email: contactEmail } : {}),
      ...(contactPhone ? { phone: contactPhone } : {}),
      externalId: ext,
    });
    return (created as { id?: string })?.id;
  }

  if (contactEmail) {
    const orgId = getOrgIdOrThrow();
    const c = await prisma.contact.findFirst({
      where: { organizationId: orgId, email: { equals: contactEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (c) {
      await syncContactFields(c.id);
      return c.id;
    }
  }
  if (contactPhone) {
    const orgId = getOrgIdOrThrow();
    // Match por variantes E.164 (com/sem 9º dígito) em vez de igualdade
    // literal — evita duplicar contato quando o formato do telefone difere.
    const foundId = await findContactIdByPhone(orgId, contactPhone);
    if (foundId) {
      await syncContactFields(foundId);
      return foundId;
    }
  }

  if (contactName || contactEmail || contactPhone) {
    const created = await createContact({
      name: contactName || contactEmail || contactPhone || "Contato sem nome",
      ...(contactEmail ? { email: contactEmail } : {}),
      ...(contactPhone ? { phone: contactPhone } : {}),
    });
    return (created as { id?: string })?.id;
  }

  return undefined;
}

// ── Criação em lote ────────────────────────────────────────────────────────

/**
 * Cria negócios em lote. Gera o `id` (uuid) de cada negócio no app para poder
 * ligar custom fields e tags SEM depender da ordem de retorno do INSERT.
 *
 * `number` (sequencial único por org): busca o max atual uma vez e distribui
 * `max+1..max+N`. Em colisão concorrente (P2002) o caller marca o lote como
 * falha — raro fora de imports simultâneos.
 *
 * Retorna um mapa rowNumber → dealId para o caller registrar external_ids.
 */
async function bulkCreateDeals(
  organizationId: string,
  batch: ResolvedRow[],
  stageNextPosition: Map<string, number>,
  importTagId: string | null,
): Promise<Map<number, string>> {
  const agg = await prisma.deal.aggregate({ _max: { number: true } });
  let nextNumber = (agg._max.number ?? 0) + 1;

  const dealRows: Prisma.DealCreateManyInput[] = [];
  const cfRows: Prisma.DealCustomFieldValueCreateManyInput[] = [];
  const tagRows: { dealId: string; tagId: string }[] = [];
  const rowNumberToId = new Map<number, string>();

  for (const r of batch) {
    const dealId = randomUUID();
    rowNumberToId.set(r.rowNumber, dealId);

    const stageId = r.stageId!; // garantido pelo caller (checou antes)
    const position = await nextPositionForStage(stageId, stageNextPosition);

    dealRows.push({
      id: dealId,
      organizationId,
      number: nextNumber++,
      title: r.title,
      stageId,
      position,
      ...(r.externalId !== null ? { externalId: r.externalId } : {}),
      ...(r.value !== undefined ? { value: r.value } : {}),
      ...(r.status ? { status: r.status as never } : {}),
      ...(r.expectedClose !== undefined ? { expectedClose: r.expectedClose } : {}),
      ...(r.lostReason !== undefined ? { lostReason: r.lostReason } : {}),
      ...(r.contactId !== undefined ? { contactId: r.contactId } : {}),
      ...(r.ownerId !== undefined ? { ownerId: r.ownerId } : {}),
    });

    for (const cf of r.customFields) {
      cfRows.push({
        organizationId,
        dealId,
        customFieldId: cf.fieldId,
        value: cf.value,
      });
    }

    if (importTagId) tagRows.push({ dealId, tagId: importTagId });
  }

  await prisma.deal.createMany({ data: dealRows });
  if (cfRows.length > 0) {
    await prisma.dealCustomFieldValue.createMany({ data: cfRows, skipDuplicates: true });
  }
  if (tagRows.length > 0) {
    await prisma.tagOnDeal.createMany({ data: tagRows, skipDuplicates: true });
  }

  return rowNumberToId;
}

async function nextPositionForStage(
  stageId: string,
  cache: Map<string, number>,
): Promise<number> {
  const cached = cache.get(stageId);
  if (cached !== undefined) {
    cache.set(stageId, cached + 1);
    return cached;
  }
  const agg = await prisma.deal.aggregate({
    where: { stageId },
    _max: { position: true },
  });
  const next = (agg._max.position ?? -1) + 1;
  cache.set(stageId, next + 1);
  return next;
}
