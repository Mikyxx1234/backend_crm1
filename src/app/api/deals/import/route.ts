import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { assertImportPermission } from "@/lib/import-guard";
import {
  attachTagToDeal,
  readDelimiterFlag,
  readTagFlag,
  readUpdateExistingFlag,
  readUploadedTable,
  upsertImportTag,
} from "@/lib/import-helpers";
import { prisma } from "@/lib/prisma";
import { enterRequestContext, getOrgIdOrThrow } from "@/lib/request-context";
import { createContact, updateContact } from "@/services/contacts";
import { createDeal, isValidDealStatus, updateDeal } from "@/services/deals";

function hasColumn(headers: string[], ...names: string[]) {
  return names.some((n) => headers.includes(n));
}

function pickDealExternalId(
  headers: string[],
  row: Record<string, string>,
): string | null | undefined {
  if (!hasColumn(headers, "external_id", "externalid", "kommo_lead_id", "lead_external_id")) {
    return undefined;
  }
  const v =
    row.external_id?.trim() ||
    row.externalid?.trim() ||
    row.kommo_lead_id?.trim() ||
    row.lead_external_id?.trim() ||
    "";
  return v === "" ? null : v;
}

async function resolveOwnerId(row: Record<string, string>): Promise<string | undefined> {
  const id = row.owner_id?.trim() || row.ownertoid?.trim();
  if (id) return id;

  const emailRaw = row.owner_email?.trim() || row.owneremail?.trim();
  if (!emailRaw) return undefined;
  const u = await prisma.user.findFirst({
    where: { email: { equals: emailRaw.toLowerCase(), mode: "insensitive" } },
    select: { id: true },
  });
  return u?.id;
}

async function resolveStageId(row: Record<string, string>): Promise<string | null> {
  const sid = row.stage_id?.trim() || row.stageid?.trim();
  if (sid) {
    const s = await prisma.stage.findUnique({ where: { id: sid }, select: { id: true } });
    return s?.id ?? null;
  }

  const pn = row.pipeline_name?.trim() || row.pipeline?.trim();
  const sn = row.stage_name?.trim() || row.stage?.trim();
  if (pn && sn) {
    const stage = await prisma.stage.findFirst({
      where: {
        name: { equals: sn, mode: "insensitive" },
        pipeline: { name: { equals: pn, mode: "insensitive" } },
      },
      select: { id: true },
    });
    return stage?.id ?? null;
  }

  return null;
}

/**
 * Resolve o contato de um deal. Estratégia em cascata:
 *   1) contact_id direto (UUID) — só busca, não cria
 *   2) contact_external_id (ou kommo_contact_id) — busca por (orgId, externalId);
 *      se NÃO existir, cria o contato com os dados opcionais disponíveis no row
 *      (contact_name, contact_email, contact_phone). Permite importar deals e
 *      contatos numa única passada.
 *   3) contact_email / contact_phone — busca por e-mail/telefone, sem criar.
 */
/**
 * Resolve o contato de um deal. Em cascata:
 *   1) contact_id (UUID/CUID) — busca, não cria/atualiza.
 *   2) contact_external_id — busca por (orgId, externalId). Se NÃO existir cria
 *      com contact_name/email/phone; se existir E updateExisting=true, atualiza
 *      o contato com os campos vindos no row (sincroniza dados do contato).
 *   3) contact_email / contact_phone — busca; não cria nem atualiza.
 */
async function resolveContactIdForDeal(
  row: Record<string, string>,
  updateExisting: boolean,
): Promise<string | undefined> {
  const contactName =
    row.contact_name?.trim() || row.contactname?.trim() || row.contact?.trim() || "";
  const contactEmail = row.contact_email?.trim() || row.contactemail?.trim() || "";
  const contactPhone = row.contact_phone?.trim() || row.contactphone?.trim() || "";

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
      // Ignora P2002 (e-mail/phone duplicado em outro contato): o link do deal
      // não deve falhar por causa de uma atualização opcional do contato.
    }
  };

  const cid = row.contact_id?.trim() || row.contactid?.trim();
  if (cid) {
    const c = await prisma.contact.findUnique({ where: { id: cid }, select: { id: true } });
    if (c) {
      await syncContactFields(c.id);
      return c.id;
    }
  }

  const ext =
    row.contact_external_id?.trim() ||
    row.contact_externalid?.trim() ||
    row.kommo_contact_id?.trim();

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

    // Auto-criação: contato referenciado por external_id ainda não existe.
    const created = await createContact({
      name: contactName || `Contato ${ext}`,
      ...(contactEmail ? { email: contactEmail } : {}),
      ...(contactPhone ? { phone: contactPhone } : {}),
      externalId: ext,
    });
    return (created as { id?: string })?.id;
  }

  // Fallback principal (quando não há external_id): identificar por email ou
  // telefone. Se não encontrar e houver dados suficientes, cria o contato.
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
    const c = await prisma.contact.findFirst({
      where: { organizationId: orgId, phone: contactPhone },
      select: { id: true },
    });
    if (c) {
      await syncContactFields(c.id);
      return c.id;
    }
  }

  // Auto-criar quando há dados mínimos para um contato novo. Requer pelo menos
  // um nome OU email OU telefone — caso contrário não há como representar o
  // contato no CRM.
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

type DealUpsert =
  | { mode: "update"; id: string }
  | { mode: "create"; id?: string; externalId?: string | null };

async function resolveDealUpsert(row: Record<string, string>): Promise<
  | { ok: true; target: DealUpsert }
  | { ok: false; message: string }
> {
  const id = row.id?.trim();
  const ext =
    row.external_id?.trim() ||
    row.externalid?.trim() ||
    row.kommo_lead_id?.trim() ||
    row.lead_external_id?.trim();
  const numRaw = row.deal_number?.trim();

  const orgId = getOrgIdOrThrow();

  // Precedência: id interno (se vier) > deal_number > external_id.
  // Em caso de conflito (ex.: usuário editou external_id no CSV apontando pra
  // outro deal), a chave mais estável vence — o external_id é tratado como
  // patch (atualiza o externalId do deal alvo). Evita rejeitar reimports
  // simples quando o usuário só queria sobrescrever dados.
  if (id) {
    const d = await prisma.deal.findUnique({ where: { id }, select: { id: true } });
    if (d) return { ok: true, target: { mode: "update", id: d.id } };
  }

  if (numRaw && /^\d+$/.test(numRaw)) {
    const d = await prisma.deal.findUnique({
      where: { organizationId_number: { organizationId: orgId, number: parseInt(numRaw, 10) } },
      select: { id: true },
    });
    if (d) return { ok: true, target: { mode: "update", id: d.id } };
  }

  if (ext) {
    const d = await prisma.deal.findUnique({
      where: { organizationId_externalId: { organizationId: orgId, externalId: ext } },
      select: { id: true },
    });
    if (d) return { ok: true, target: { mode: "update", id: d.id } };
  }

  return {
    ok: true,
    target: {
      mode: "create",
      ...(id ? { id } : {}),
      ...(ext ? { externalId: ext } : {}),
    },
  };
}

function parseExpectedClose(raw: string | undefined): Date | null | undefined {
  if (!raw?.trim()) return undefined;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    const denied = assertImportPermission(session);
    if (denied) return denied;

    // Populate AsyncLocalStorage para que getOrgIdOrThrow() funcione
    // nas funcoes de resolucao (stage/contact/deal) e no Prisma multi-tenant.
    if (session?.user?.organizationId) {
      enterRequestContext({
        organizationId: session.user.organizationId,
        userId: session.user.id,
        isSuperAdmin: Boolean(session.user.isSuperAdmin),
      });
    }

    const permissionDenied = await requirePermissionForUser(
      (session?.user ?? {}) as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
      "deal:create",
    );
    if (permissionDenied) return permissionDenied;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "Envie o arquivo CSV no campo \"file\" (multipart/form-data)." },
        { status: 400 },
      );
    }

    const delimiter = readDelimiterFlag(formData);
    const updateExisting = readUpdateExistingFlag(formData);
    const tagName = readTagFlag(formData);

    const { headers, rows } = await readUploadedTable(file, delimiter);

    if (headers.length === 0 || !headers.includes("title")) {
      return NextResponse.json(
        {
          message:
            "CSV inválido: coluna \"title\" obrigatória. Informe \"stage_id\" ou \"pipeline_name\" + \"stage_name\".",
        },
        { status: 400 },
      );
    }

    const hasStage = headers.includes("stage_id") || headers.includes("stageid");
    const hasPipelineStage =
      (headers.includes("pipeline_name") || headers.includes("pipeline")) &&
      (headers.includes("stage_name") || headers.includes("stage"));

    if (!hasStage && !hasPipelineStage) {
      return NextResponse.json(
        {
          message:
            "Inclua \"stage_id\" (recomendado) ou o par \"pipeline_name\" + \"stage_name\" para localizar o estágio.",
        },
        { status: 400 },
      );
    }

    let importTagId: string | null = null;
    if (tagName) {
      try {
        const orgId = getOrgIdOrThrow();
        importTagId = await upsertImportTag(orgId, tagName);
      } catch {
        importTagId = null;
      }
    }

    const failed: { row: number; message: string }[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      const title = row.title?.trim();
      if (!title) {
        failed.push({ row: rowNumber, message: "Título vazio." });
        continue;
      }

      const stageId = await resolveStageId(row);
      if (!stageId) {
        failed.push({ row: rowNumber, message: "Estágio não encontrado (stage_id ou pipeline+estágio)." });
        continue;
      }

      const statusRaw = row.status?.trim()?.toUpperCase();
      if (statusRaw && !isValidDealStatus(statusRaw)) {
        failed.push({ row: rowNumber, message: "status inválido (OPEN, WON, LOST)." });
        continue;
      }

      let value: number | undefined;
      const valRaw = row.value?.trim();
      if (valRaw) {
        const n = Number.parseFloat(valRaw.replace(",", "."));
        if (!Number.isFinite(n)) {
          failed.push({ row: rowNumber, message: "value inválido." });
          continue;
        }
        value = n;
      }

      const expectedClose = parseExpectedClose(row.expected_close?.trim() || row.expectedclose?.trim());
      if (expectedClose === null) {
        failed.push({ row: rowNumber, message: "expected_close inválido." });
        continue;
      }

      let ownerId: string | undefined;
      try {
        ownerId = await resolveOwnerId(row);
      } catch {
        failed.push({ row: rowNumber, message: "Erro ao resolver proprietário." });
        continue;
      }

      let contactId: string | undefined;
      try {
        contactId = await resolveContactIdForDeal(row, updateExisting);
      } catch {
        failed.push({ row: rowNumber, message: "Erro ao resolver contato." });
        continue;
      }

      const resolved = await resolveDealUpsert(row);
      if (!resolved.ok) {
        failed.push({ row: rowNumber, message: resolved.message });
        continue;
      }

      const externalPatch = pickDealExternalId(headers, row);

      const lostReason = row.lost_reason?.trim() || row.lostreason?.trim() || undefined;

      try {
        let dealId: string | null = null;
        if (resolved.target.mode === "update") {
          if (!updateExisting) {
            skipped += 1;
            if (importTagId) await attachTagToDeal(resolved.target.id, importTagId);
            continue;
          }
          await updateDeal(resolved.target.id, {
            title,
            stageId,
            ...(value !== undefined ? { value } : {}),
            ...(statusRaw && isValidDealStatus(statusRaw) ? { status: statusRaw } : {}),
            ...(expectedClose !== undefined ? { expectedClose } : {}),
            ...(lostReason !== undefined ? { lostReason } : {}),
            ...(contactId !== undefined ? { contactId } : {}),
            ...(ownerId !== undefined ? { ownerId } : {}),
            ...(externalPatch !== undefined ? { externalId: externalPatch } : {}),
          });
          dealId = resolved.target.id;
          updated += 1;
        } else {
          let externalForCreate: string | null | undefined = undefined;
          if (externalPatch !== undefined) {
            externalForCreate = externalPatch;
          } else if (resolved.target.externalId !== undefined) {
            externalForCreate = resolved.target.externalId;
          }
          const d = await createDeal({
            ...(resolved.target.id ? { id: resolved.target.id } : {}),
            externalId: externalForCreate === undefined ? undefined : externalForCreate,
            title,
            stageId,
            value,
            status: statusRaw && isValidDealStatus(statusRaw) ? statusRaw : undefined,
            expectedClose,
            lostReason,
            contactId: contactId ?? undefined,
            ownerId,
          });
          dealId = (d as { id?: string })?.id ?? null;
          created += 1;
        }

        if (importTagId && dealId) {
          await attachTagToDeal(dealId, importTagId);
        }
      } catch (e: unknown) {
        const code =
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code: string }).code)
            : "";
        const msg =
          e instanceof Error && e.message === "INVALID_TITLE"
            ? "Título inválido."
            : code === "P2002"
              ? "Violação de unicidade (id externo ou número duplicado)."
              : code === "P2003"
                ? "Referência inválida (contato, estágio ou usuário)."
                : "Erro ao salvar negócio.";
        failed.push({ row: rowNumber, message: msg });
      }
    }

    return NextResponse.json(
      {
        created,
        updated,
        skipped,
        failed,
        totalRows: rows.length,
        tagId: importTagId,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao importar negócios." }, { status: 500 });
  }
}
