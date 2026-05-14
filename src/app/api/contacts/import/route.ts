import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { parseCsv } from "@/lib/csv-parse";
import { assertImportPermission } from "@/lib/import-guard";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { createContact, isValidLifecycleStage, updateContact } from "@/services/contacts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasColumn(headers: string[], ...names: string[]) {
  return names.some((n) => headers.includes(n));
}

function pickContactExternalId(
  headers: string[],
  row: Record<string, string>,
): string | null | undefined {
  if (
    !hasColumn(headers, "external_id", "externalid", "kommo_contact_id", "contact_external_id")
  ) {
    return undefined;
  }
  const v =
    row.external_id?.trim() ||
    row.externalid?.trim() ||
    row.kommo_contact_id?.trim() ||
    row.contact_external_id?.trim() ||
    "";
  return v === "" ? null : v;
}

async function resolveCompanyId(row: Record<string, string>): Promise<string | undefined> {
  const direct = row.company_id?.trim() || row.companyid?.trim();
  if (direct) return direct;

  const name = row.company?.trim();
  if (!name) return undefined;

  const found = await prisma.company.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  return found?.id;
}

async function resolveAssignedToId(row: Record<string, string>): Promise<string | undefined> {
  const id =
    row.assigned_to_id?.trim() ||
    row.assignedtoid?.trim() ||
    row.owner_id?.trim() ||
    row.ownertoid?.trim();
  if (id) return id;

  const emailRaw =
    row.assigned_to_email?.trim() ||
    row.assignedtoemail?.trim() ||
    row.owner_email?.trim() ||
    row.owneremail?.trim();
  if (!emailRaw) return undefined;
  const email = emailRaw.toLowerCase();
  const u = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return u?.id;
}

type UpsertTarget =
  | { mode: "update"; id: string }
  | { mode: "create"; id?: string; externalId?: string | null };

async function resolveContactUpsert(row: Record<string, string>): Promise<
  | { ok: true; target: UpsertTarget }
  | { ok: false; message: string }
> {
  const id = row.id?.trim();
  const ext =
    row.external_id?.trim() ||
    row.externalid?.trim() ||
    row.kommo_contact_id?.trim() ||
    row.contact_external_id?.trim();

  if (id && ext) {
    const orgId = getOrgIdOrThrow();
    const [byId, byExt] = await Promise.all([
      prisma.contact.findUnique({ where: { id }, select: { id: true } }),
      prisma.contact.findUnique({
        where: { organizationId_externalId: { organizationId: orgId, externalId: ext } },
        select: { id: true },
      }),
    ]);
    if (byId && byExt && byId.id !== byExt.id) {
      return { ok: false, message: "id e external_id referem contatos diferentes." };
    }
    if (byId) return { ok: true, target: { mode: "update", id: byId.id } };
    if (byExt) return { ok: true, target: { mode: "update", id: byExt.id } };
    return { ok: true, target: { mode: "create", id, externalId: ext } };
  }

  if (id) {
    const c = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (c) return { ok: true, target: { mode: "update", id: c.id } };
    return { ok: true, target: { mode: "create", id, externalId: ext ?? undefined } };
  }

  if (ext) {
    const orgId = getOrgIdOrThrow();
    const c = await prisma.contact.findUnique({
      where: { organizationId_externalId: { organizationId: orgId, externalId: ext } },
      select: { id: true },
    });
    if (c) return { ok: true, target: { mode: "update", id: c.id } };
    return { ok: true, target: { mode: "create", externalId: ext } };
  }

  return { ok: true, target: { mode: "create" } };
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    const denied = assertImportPermission(session);
    if (denied) return denied;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "Envie o arquivo CSV no campo \"file\" (multipart/form-data)." },
        { status: 400 },
      );
    }

    const text = await file.text();
    const { headers, rows } = parseCsv(text);

    if (headers.length === 0 || !headers.includes("name")) {
      return NextResponse.json(
        { message: "CSV inválido: é necessária uma coluna \"name\"." },
        { status: 400 },
      );
    }

    const failed: { row: number; message: string }[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      const name = row.name?.trim();
      if (!name) {
        failed.push({ row: rowNumber, message: "Nome vazio." });
        continue;
      }

      const emailRaw = row.email?.trim();
      if (emailRaw && !EMAIL_RE.test(emailRaw.toLowerCase())) {
        failed.push({ row: rowNumber, message: "E-mail inválido." });
        continue;
      }

      const lifecycleRaw =
        row.lifecycle_stage?.trim() ||
        row.lifecyclestage?.trim() ||
        row.lifecycle?.trim();
      if (lifecycleRaw && !isValidLifecycleStage(lifecycleRaw)) {
        failed.push({ row: rowNumber, message: "Estágio do ciclo inválido." });
        continue;
      }

      let leadScore: number | undefined;
      const ls =
        row.lead_score?.trim() ||
        row.leadscore?.trim() ||
        row.score?.trim();
      if (ls) {
        const n = Number.parseInt(ls, 10);
        if (!Number.isFinite(n)) {
          failed.push({ row: rowNumber, message: "leadScore inválido." });
          continue;
        }
        leadScore = n;
      }

      let companyId: string | undefined;
      try {
        companyId = await resolveCompanyId(row);
      } catch {
        failed.push({ row: rowNumber, message: "Erro ao resolver empresa." });
        continue;
      }

      let assignedToId: string | undefined;
      try {
        assignedToId = await resolveAssignedToId(row);
      } catch {
        failed.push({ row: rowNumber, message: "Erro ao resolver responsável." });
        continue;
      }

      const resolved = await resolveContactUpsert(row);
      if (!resolved.ok) {
        failed.push({ row: rowNumber, message: resolved.message });
        continue;
      }

      const externalPatch = pickContactExternalId(headers, row);

      const basePayload = {
        name,
        email: emailRaw ? emailRaw.toLowerCase() : undefined,
        phone: row.phone?.trim() || undefined,
        avatarUrl: row.avatar_url?.trim() || row.avatarurl?.trim() || undefined,
        source: row.source?.trim() || undefined,
        leadScore,
        lifecycleStage:
          lifecycleRaw && isValidLifecycleStage(lifecycleRaw) ? lifecycleRaw : undefined,
        companyId: companyId ?? undefined,
        assignedToId,
      };

      try {
        if (resolved.target.mode === "update") {
          await updateContact(resolved.target.id, {
            ...basePayload,
            ...(externalPatch !== undefined ? { externalId: externalPatch } : {}),
          });
          updated += 1;
        } else {
          let externalForCreate: string | null | undefined = undefined;
          if (externalPatch !== undefined) {
            externalForCreate = externalPatch;
          } else if (resolved.target.mode === "create" && resolved.target.externalId !== undefined) {
            externalForCreate = resolved.target.externalId;
          }
          await createContact({
            ...(resolved.target.id ? { id: resolved.target.id } : {}),
            externalId: externalForCreate === undefined ? undefined : externalForCreate,
            ...basePayload,
          });
          created += 1;
        }
      } catch (e: unknown) {
        const code =
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code: string }).code)
            : "";
        const msg =
          code === "P2002"
            ? "Violação de unicidade (e-mail/telefone/id externo duplicado)."
            : code === "P2003"
              ? "Referência inválida (empresa ou usuário)."
              : "Erro ao salvar contato.";
        failed.push({ row: rowNumber, message: msg });
      }
    }

    return NextResponse.json(
      {
        created,
        updated,
        failed,
        totalRows: rows.length,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao importar contatos." }, { status: 500 });
  }
}
