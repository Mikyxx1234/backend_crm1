/**
 * Replay do Agente IA em conversas presas (inbound sem resposta).
 *
 * Caso típico: deal em Lead de Entrada — a IA era bloqueada e o aluno
 * ficou sem atendimento. Após remover o gate, este script assume e responde.
 *
 *   npx tsx src/scripts/ops-replay-stuck-ai-inbox.ts
 *   npx tsx src/scripts/ops-replay-stuck-ai-inbox.ts --apply
 *   npx tsx src/scripts/ops-replay-stuck-ai-inbox.ts --apply --hours=24 --limit=80
 *   npx tsx src/scripts/ops-replay-stuck-ai-inbox.ts --apply --numbers=54572,54571
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

function argValue(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const hours = Math.max(1, Number.parseInt(argValue("--hours", "24"), 10) || 24);
  const limit = Math.max(1, Number.parseInt(argValue("--limit", "80"), 10) || 80);
  const orgFilter = argValue("--org", "").trim() || null;
  const numbers = argValue("--numbers", "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const { prismaBase } = await import("@/lib/prisma-base");
  const { withSystemContext } = await import("@/lib/webhook-context");
  const { ensureInboundAiAttendance } = await import(
    "@/services/ai/first-attendance"
  );
  const { collectUnansweredInboundText } = await import(
    "@/services/ai/inbound-debounce"
  );
  const { maybeReplyAsAIAgent } = await import("@/services/ai/inbox-handler");
  const { cancelActiveContextsForContact } = await import(
    "@/services/automation-context"
  );

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await prismaBase.conversation.findMany({
    where: {
      status: "OPEN",
      contactId: { not: null },
      ...(orgFilter ? { organizationId: orgFilter } : {}),
      ...(numbers.length
        ? { number: { in: numbers } }
        : {
            hasHumanReply: false,
            lastMessageDirection: "in",
            lastInboundAt: { gte: since },
            OR: [{ assignedToId: null }, { assignedTo: { is: { type: "AI" } } }],
          }),
    },
    select: {
      id: true,
      number: true,
      organizationId: true,
      contactId: true,
      assignedToId: true,
      lastInboundAt: true,
      channel: true,
      assignedTo: { select: { name: true, type: true } },
      contact: { select: { name: true } },
      channelRef: { select: { provider: true } },
    },
    orderBy: { lastInboundAt: "desc" },
    take: limit * 3,
  });

  const candidates: typeof rows = [];
  for (const row of rows) {
    if (!row.contactId) continue;
    if (numbers.length || row.assignedTo?.type === "AI") {
      candidates.push(row);
      continue;
    }
    const deal = await prismaBase.deal.findFirst({
      where: { contactId: row.contactId, status: "OPEN" },
      select: {
        stage: { select: { name: true, slug: true, pipeline: { select: { name: true } } } },
      },
      orderBy: { updatedAt: "desc" },
    });
    const pipe = deal?.stage?.pipeline?.name ?? "";
    const stage = deal?.stage?.name ?? "";
    const slug = deal?.stage?.slug ?? "";
    const academic =
      /academ/i.test(pipe) ||
      slug === "lead-de-entrada" ||
      /^lead de entrada$/i.test(stage);
    if (academic) candidates.push(row);
    if (candidates.length >= limit) break;
  }

  console.log(
    `[replay-ai] ${candidates.length} conversa(s) presa(s) nas últimas ${hours}h` +
      `${apply ? "" : " (dry-run — use --apply para responder)"}`,
  );

  for (const c of candidates) {
    const text = await withSystemContext(c.organizationId, () =>
      collectUnansweredInboundText(c.id),
    );
    console.log(
      `  #${c.number} ${c.contact?.name ?? "?"} assignee=${c.assignedTo?.name ?? "—"} ` +
        `in=${c.lastInboundAt?.toISOString() ?? "?"} msg=${JSON.stringify(text.slice(0, 80))}`,
    );
  }

  if (!apply) {
    await prismaBase.$disconnect();
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of candidates) {
    if (!c.contactId) {
      skipped++;
      continue;
    }
    const channel =
      c.channelRef?.provider === "BAILEYS_MD" || /baileys/i.test(c.channel)
        ? "baileys"
        : "meta";
    try {
      const result = await withSystemContext(
        c.organizationId,
        async () => {
          const cancelled = await cancelActiveContextsForContact(c.contactId!);
          const assigned = await ensureInboundAiAttendance({
            conversationId: c.id,
            contactId: c.contactId!,
          });
          const text = await collectUnansweredInboundText(c.id);
          if (!text.trim()) return { status: "empty" as const, cancelled, assigned };
          await maybeReplyAsAIAgent({
            conversationId: c.id,
            contactId: c.contactId!,
            userMessage: text,
            channel,
          });
          return { status: "replied" as const, cancelled, assigned };
        },
        { actor: { type: "AI", label: "Agente IA", sublabel: "ops-replay" } },
      );
      if (result.status === "empty") {
        skipped++;
        console.log(`  skip #${c.number} (sem inbound pendente)`);
      } else {
        ok++;
        console.log(
          `  ok #${c.number} assigned=${result.assigned ?? "—"} cancelledCtx=${result.cancelled}`,
        );
      }
    } catch (err) {
      failed++;
      console.error(
        `  fail #${c.number}:`,
        err instanceof Error ? err.message : err,
      );
    }
    await sleep(1500);
  }

  console.log(`[replay-ai] done ok=${ok} skipped=${skipped} failed=${failed}`);
  await prismaBase.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
