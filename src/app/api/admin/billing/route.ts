/**
 * GET /api/admin/billing — listagem de subscriptions + uso do periodo (PR 6.3).
 *
 * Apenas super-admins (User.isSuperAdmin=true) — bypass RLS via prismaBase.
 *
 * Resposta:
 *   {
 *     organizations: [
 *       {
 *         id, name, slug, status,
 *         subscription: { planKey, status, stripeSubId, periodEnd, ... } | null,
 *         usage: { messages_sent: number, ai_tokens: number, ... },
 *         limits: { messages_sent: 10000, ... },
 *         overLimit: { messages_sent: false, ... }
 *       }
 *     ],
 *     totals: { mrrUsd, orgsActive, orgsPastDue, orgsCanceled }
 *   }
 *
 * Performance: query e aglomerada — N orgs * 1 SUM por meter. Pra
 * tenants > 1k orgs, paginar. Por hora retorna tudo (use cliente
 * EduIT esperado < 100 orgs).
 */
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentPeriodUsage } from "@/lib/billing/aggregate";
import { getEffectiveLimit, getPlan, PLANS } from "@/lib/billing/plans";
import { listMeters, type MeterKey } from "@/lib/billing/meters";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const orgs = await prismaBase.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      createdAt: true,
      subscription: {
        select: {
          planKey: true,
          status: true,
          stripeSubscriptionId: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          limitsOverride: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const meters = listMeters();
  const orgsWithUsage = await Promise.all(
    orgs.map(async (org) => {
      const usage = await getCurrentPeriodUsage(org.id);
      const planKey = org.subscription?.planKey ?? "free";
      const overrides = (org.subscription?.limitsOverride ?? null) as
        | Record<MeterKey, number>
        | null;
      const limits: Record<string, number | null> = {};
      const overLimit: Record<string, boolean> = {};
      for (const m of meters) {
        const limit = getEffectiveLimit(planKey, m.key as MeterKey, overrides);
        limits[m.key] = limit;
        overLimit[m.key] =
          limit !== null && Number(usage[m.key as MeterKey] ?? BigInt(0)) > limit;
      }
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        subscription: org.subscription,
        usage: Object.fromEntries(
          Object.entries(usage).map(([k, v]) => [k, Number(v)]),
        ) as Record<string, number>,
        limits,
        overLimit,
      };
    }),
  );

  // Totals
  let mrrUsd = 0;
  let orgsActive = 0;
  let orgsPastDue = 0;
  let orgsCanceled = 0;
  for (const o of orgsWithUsage) {
    const sub = o.subscription;
    if (!sub) continue;
    const plan = getPlan(sub.planKey);
    if (sub.status === "ACTIVE" || sub.status === "TRIALING") {
      orgsActive++;
      mrrUsd += plan.priceUsd;
    } else if (sub.status === "PAST_DUE" || sub.status === "UNPAID") {
      orgsPastDue++;
      mrrUsd += plan.priceUsd; // ainda pendente, mas conta no MRR
    } else {
      orgsCanceled++;
    }
  }

  return NextResponse.json({
    organizations: orgsWithUsage,
    totals: { mrrUsd, orgsActive, orgsPastDue, orgsCanceled },
    plans: PLANS,
    meters,
  });
}
