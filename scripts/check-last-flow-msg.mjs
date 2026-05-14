// Checa as últimas mensagens inbound interativas (Flow) numa conversa
// específica. Se o `content` for "Fluxo (resposta): Sent", sinal de que
// o backend está rodando código ANTES do fix `c2d945d`.
//
// Uso:
//   DATABASE_URL=... node scripts/check-last-flow-msg.mjs <conversationId>
import { Client } from "pg";

const conversationId = process.argv[2] || "cmolyhn8y00ippm010axvvvri";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL não setado."); process.exit(1); }

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

console.log(`=== Últimas 10 mensagens da conv ${conversationId} ===\n`);
const msgs = (await c.query(`
  SELECT id, direction, "messageType", content, "createdAt", "externalId"
  FROM messages
  WHERE "conversationId" = $1
  ORDER BY "createdAt" DESC
  LIMIT 10
`, [conversationId])).rows;

for (const m of msgs) {
  const ts = m.createdAt.toISOString();
  const preview = m.content.length > 120
    ? m.content.slice(0, 120) + "…"
    : m.content;
  console.log(`[${ts}] dir=${m.direction} type=${m.messageType}`);
  console.log(`    "${preview}"`);
  console.log();
}

console.log("\n=== Diagnóstico ===");
const latestFlowAnswer = msgs.find((m) =>
  m.direction === "in" &&
  m.messageType === "interactive" &&
  (m.content.includes("Fluxo (resposta)") || m.content.includes("Resposta do formulário")),
);
if (!latestFlowAnswer) {
  console.log("Nenhuma mensagem interativa de Flow nas últimas 10 mensagens.");
} else if (latestFlowAnswer.content.startsWith("Fluxo (resposta): Sent")) {
  console.log("⚠️  Última resposta de Flow tem content = 'Fluxo (resposta): Sent'");
  console.log("    Criada em: " + latestFlowAnswer.createdAt.toISOString());
  console.log("    Isso significa que o backend ESTÁ RODANDO CÓDIGO ANTIGO");
  console.log("    (versão anterior ao commit c2d945d).");
  console.log("    Ação: Rebuild do banco-backend-crm SEM cache no Easypanel.");
} else if (latestFlowAnswer.content.startsWith("📋")) {
  console.log("✓ Última resposta de Flow está formatada (📋 ...).");
  console.log("    O fix está ativo. Se ainda vê 'Sent' na UI, é cache do navegador.");
}

await c.end();
