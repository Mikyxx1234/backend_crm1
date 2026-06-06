/**
 * Service da Central de Widgets — estado de instalacao por organizacao.
 *
 * A definicao dos widgets vem do catalogo estatico (`@/lib/widget-catalog`).
 * Aqui so lidamos com o ESTADO por org (ACTIVE/INACTIVE) na tabela
 * `OrganizationWidget`. O `organizationId` vem SEMPRE do contexto da request
 * (`getOrgIdOrThrow`) — nunca do body — e a Prisma Extension de
 * organization-scope reforca o isolamento.
 */

import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";
import {
  AVAILABLE_WIDGETS,
  getWidgetBySlug,
  isInstallableSlug,
  type WidgetDefinition,
} from "@/lib/widget-catalog";

/** Erro de slug invalido — o route handler mapeia para HTTP 400. */
export class InvalidWidgetSlugError extends Error {
  constructor(slug: string) {
    super(`Widget slug invalido: ${slug}`);
    this.name = "InvalidWidgetSlugError";
  }
}

export type WidgetInstallStatus = "ACTIVE" | "INACTIVE";

export interface WidgetWithState extends WidgetDefinition {
  /** True quando o widget esta instalado E ativo para a org atual. */
  installed: boolean;
  /** Estado persistido ("ACTIVE" | "INACTIVE") ou null se nunca instalado. */
  status: WidgetInstallStatus | null;
  /** ISO da ultima instalacao/reativacao, ou null. */
  installedAt: string | null;
}

/**
 * Lista o catalogo de widgets mesclado com o estado da organizacao atual.
 * Sempre retorna TODOS os widgets do catalogo (mesmo nao instalados).
 */
export async function listWidgetsWithState(): Promise<WidgetWithState[]> {
  const rows = await prisma.organizationWidget.findMany({
    select: { widgetSlug: true, status: true, installedAt: true },
  });
  const bySlug = new Map(rows.map((r) => [r.widgetSlug, r]));

  return AVAILABLE_WIDGETS.map((widget) => {
    const row = bySlug.get(widget.slug);
    const status = (row?.status as WidgetInstallStatus | undefined) ?? null;
    return {
      ...widget,
      installed: status === "ACTIVE",
      status,
      installedAt: row?.installedAt ? row.installedAt.toISOString() : null,
    };
  });
}

/**
 * Instala (ou reativa) um widget para a organizacao atual.
 * - Valida o slug contra o catalogo (apenas widgets "available").
 * - Se ja estiver ACTIVE, e idempotente (nao mexe em installedAt).
 * - Se existir INACTIVE, reativa atualizando installedAt/installedById.
 * - Caso contrario, cria o registro ACTIVE.
 */
export async function installWidget(slug: string, userId: string): Promise<void> {
  if (!isInstallableSlug(slug)) throw new InvalidWidgetSlugError(slug);
  const organizationId = getOrgIdOrThrow();

  const existing = await prisma.organizationWidget.findUnique({
    where: { organizationId_widgetSlug: { organizationId, widgetSlug: slug } },
    select: { status: true },
  });

  // Ja ativo: idempotente, evita efeitos colaterais desnecessarios.
  if (existing?.status === "ACTIVE") return;

  await prisma.organizationWidget.upsert({
    where: { organizationId_widgetSlug: { organizationId, widgetSlug: slug } },
    update: { status: "ACTIVE", installedAt: new Date(), installedById: userId },
    create: {
      organizationId,
      widgetSlug: slug,
      status: "ACTIVE",
      installedById: userId,
    },
  });
}

/**
 * Desativa um widget para a organizacao atual (status INACTIVE).
 * Nunca deleta fisicamente. Idempotente: se nao existir registro, no-op.
 */
export async function uninstallWidget(slug: string): Promise<void> {
  if (!getWidgetBySlug(slug)) throw new InvalidWidgetSlugError(slug);
  const organizationId = getOrgIdOrThrow();

  await prisma.organizationWidget.updateMany({
    where: { organizationId, widgetSlug: slug },
    data: { status: "INACTIVE" },
  });
}

/**
 * Helper para gating futuro de features: true se a org atual tem o widget
 * ativo. O `organizationId` vem do contexto (org-scope), entao basta o slug.
 */
export async function hasOrganizationWidget(slug: string): Promise<boolean> {
  const row = await prisma.organizationWidget.findFirst({
    where: { widgetSlug: slug, status: "ACTIVE" },
    select: { id: true },
  });
  return Boolean(row);
}
