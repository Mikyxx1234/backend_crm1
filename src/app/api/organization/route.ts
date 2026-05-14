/**
 * /api/organization
 * ─────────────────
 * Retorna dados da organização do usuário logado. Usado pela sidebar
 * pra renderizar a logo/nome da empresa em vez do branding "E" do EduIT.
 *
 * Payload mínimo: id, name, slug, logoUrl, primaryColor, status,
 * onboardingCompletedAt. Não expõe nada sensível — é metadata de
 * identidade visual que já foi configurada pelo próprio usuário
 * durante o onboarding.
 *
 * Super-admin EduIT (isSuperAdmin=true, org=org_eduit) recebe a própria
 * org EduIT por default. Pra impersonar outra org ele usa o painel
 * /admin/organizations (outro endpoint, escopado).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  primaryColor: true,
  status: true,
  onboardingCompletedAt: true,
} as const;

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const orgId = (session?.user as { organizationId?: string } | undefined)
    ?.organizationId;
  if (!userId || !orgId) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: ORG_SELECT,
  });
  if (!org) {
    return NextResponse.json(
      { message: "Organização não encontrada." },
      { status: 404 },
    );
  }
  return NextResponse.json(org);
}
