/**
 * Reconstrói o dia de um consultor na Distribuição para explicar como ele
 * recebeu mais leads do que o `queueLimit`.
 *
 * Contexto (04/ago/26): Wesley (Cruzeiro EaD) ficou online de manhã e recebeu
 * 45 leads com limite 25. A hipótese é que o limite nunca foi violado do ponto
 * de vista do motor — `getQueueCounts` só conta conversa em que é a VEZ DELE
 * responder, então cada resposta que ele manda libera uma vaga e puxa o
 * próximo da fila. O script mostra a fila contada no instante de cada
 * atribuição (snapshot gravado em `distribution_logs.evaluated`), que é a
 * prova direta: se ela oscila abaixo do teto, o motor agiu como programado.
 *
 * Também confere a segunda hipótese: consultor em vários departamentos, onde
 * o teto é comparado contra a fila DAQUELE departamento e não a global.
 *
 * Somente leitura.
 *
 * Uso:
 *   node scripts/diag-distribution-overflow.mjs --org <id> --user <nome|email>
 *   node scripts/diag-distribution-overflow.mjs --org <id> --user Wesley --date 2026-08-04
 */
import fs from "node:fs";
import pg from "pg";

const ENV_PATH = "C:/Users/Caio/Desktop/.env produção.txt";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const ORG = arg("org");
const USER_TERM = arg("user");
const DATE = arg("date"); // YYYY-MM-DD em America/Sao_Paulo

if (!ORG || !USER_TERM) {
  console.error(
    "Uso: node scripts/diag-distribution-overflow.mjs --org <id> --user <nome|email> [--date YYYY-MM-DD]",
  );
  process.exit(1);
}

function readDatabaseUrl() {
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  const line = raw
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("DATABASE_URL"));
  if (!line) throw new Error(`DATABASE_URL não encontrada em ${ENV_PATH}`);
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

/** Meia-noite (America/Sao_Paulo) do dia pedido, em UTC. Brasil sem horário de verão. */
function startOfDayUtc(dateStr) {
  const d = dateStr ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 3, 0, 0));
}

const hhmm = (d) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));

async function main() {
  const client = new pg.Client({
    connectionString: readDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const since = startOfDayUtc(DATE);
  const until = new Date(since.getTime() + 24 * 3600 * 1000);

  const { rows: users } = await client.query(
    `SELECT id, name, email FROM users
      WHERE "organizationId" = $1 AND type = 'HUMAN'
        AND (name ILIKE $2 OR email ILIKE $2)`,
    [ORG, `%${USER_TERM}%`],
  );
  if (users.length === 0) throw new Error(`Nenhum usuário casa com "${USER_TERM}".`);
  if (users.length > 1) {
    console.log("Mais de um usuário casou — refine o termo:");
    for (const u of users) console.log(`  ${u.id}  ${u.name}  ${u.email}`);
    return;
  }
  const user = users[0];

  const { rows: cfgRows } = await client.query(
    `SELECT "queueLimit", participates, paused FROM distribution_responsibles
      WHERE "organizationId" = $1 AND "userId" = $2`,
    [ORG, user.id],
  );
  const cfg = cfgRows[0] ?? { queueLimit: 0, participates: true, paused: false };

  const { rows: depts } = await client.query(
    `SELECT d.id, d.name FROM department_members dm
       JOIN departments d ON d.id = dm."departmentId"
      WHERE dm."userId" = $1 AND dm."organizationId" = $2
      ORDER BY d.name`,
    [user.id, ORG],
  );

  console.log("=".repeat(78));
  console.log(`${user.name} <${user.email}>`);
  console.log(
    `queueLimit=${cfg.queueLimit}  participa=${cfg.participates}  pausado=${cfg.paused}`,
  );
  if (cfg.queueLimit === 0) {
    console.log(
      "  ATENÇÃO: queueLimit=0 significa SEM LIMITE para o motor. Se você" +
        "\n  configurou 25 na tela, o valor não chegou ao banco — essa é a causa.",
    );
  }
  if (cfgRows.length === 0) {
    console.log(
      "  ATENÇÃO: não existe linha em distribution_responsibles para ele —" +
        "\n  o motor usa os defaults (queueLimit=0 = sem limite).",
    );
  }
  console.log(
    `departamentos: ${depts.length > 0 ? depts.map((d) => d.name).join(", ") : "(nenhum)"}`,
  );
  console.log(
    `janela: ${since.toISOString()} → ${until.toISOString()} (dia em America/Sao_Paulo)`,
  );
  console.log("=".repeat(78));

  // 1) Atribuições do dia, com a fila contada no instante de cada uma.
  const { rows: logs } = await client.query(
    `SELECT l.id, l."createdAt", l."triggerSource", l."conversationId",
            l."departmentId", d.name AS dept, l.evaluated
       FROM distribution_logs l
       LEFT JOIN departments d ON d.id = l."departmentId"
      WHERE l."organizationId" = $1 AND l.success = true
        AND l."selectedUserId" = $2
        AND l."createdAt" >= $3 AND l."createdAt" < $4
      ORDER BY l."createdAt" ASC`,
    [ORG, user.id, since, until],
  );

  console.log(`\n[1] Distribuições bem-sucedidas para ele hoje: ${logs.length}`);
  console.log(
    "    (fila = queueCount dele no snapshot gravado no momento da escolha)\n",
  );
  console.log("    hora   fila  origem              departamento");
  let maxSeen = 0;
  let everAtLimit = 0;
  for (const l of logs) {
    const arr = Array.isArray(l.evaluated) ? l.evaluated : [];
    const me = arr.find((e) => e.userId === user.id);
    const q = me?.queueCount ?? null;
    if (typeof q === "number") {
      maxSeen = Math.max(maxSeen, q);
      if (cfg.queueLimit > 0 && q >= cfg.queueLimit) everAtLimit++;
    }
    console.log(
      `    ${hhmm(l.createdAt)}  ${String(q ?? "?").padStart(4)}  ` +
        `${String(l.triggerSource).padEnd(18)}  ${l.dept ?? "(sem depto)"}`,
    );
  }
  console.log(
    `\n    maior fila observada no momento das escolhas: ${maxSeen}` +
      (cfg.queueLimit > 0 ? ` (limite ${cfg.queueLimit})` : ""),
  );
  console.log(
    `    escolhas feitas com a fila já no limite: ${everAtLimit}` +
      (everAtLimit === 0
        ? "  → o motor NUNCA violou o teto; o teto é que esvazia."
        : "  → há violação real do teto, investigar concorrência."),
  );

  // 2) Onde estão as conversas de hoje agora — as "Respondidas" são as que
  //    saíram da conta e liberaram vaga.
  const { rows: buckets } = await client.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'OPEN')::int AS abertas,
        COUNT(*) FILTER (WHERE status <> 'OPEN')::int AS encerradas,
        COUNT(*) FILTER (WHERE status = 'OPEN' AND "hasError" = false
                           AND ("hasHumanReply" = false OR "lastMessageDirection" = 'in'))::int AS contam_na_fila,
        COUNT(*) FILTER (WHERE status = 'OPEN' AND "hasError" = false
                           AND "hasHumanReply" = true AND "lastMessageDirection" = 'out')::int AS respondidas,
        COUNT(*) FILTER (WHERE status = 'OPEN' AND "hasError" = true)::int AS com_erro
       FROM conversations
      WHERE "organizationId" = $1 AND "assignedToId" = $2
        AND "createdAt" >= $3 AND "createdAt" < $4`,
    [ORG, user.id, since, until],
  );
  const b = buckets[0];
  console.log(`\n[2] Conversas criadas hoje e atribuídas a ele: ${b.total}`);
  console.log(`    abertas ................. ${b.abertas}`);
  console.log(`      contam na fila ........ ${b.contam_na_fila}  <- é o que o limite enxerga`);
  console.log(`      respondidas (saíram) .. ${b.respondidas}  <- cada uma liberou uma vaga`);
  console.log(`      com erro (saíram) ..... ${b.com_erro}`);
  console.log(`    encerradas .............. ${b.encerradas}`);

  // 3) Fila contada AGORA: global vs por departamento. Divergência aqui é a
  //    segunda porta de escape — o motor compara o teto contra a fila do
  //    departamento quando a distribuição é departamental.
  const { rows: nowRows } = await client.query(
    `SELECT COALESCE(d.name, '(sem departamento)') AS dept, COUNT(*)::int AS n
       FROM conversations c
       LEFT JOIN departments d ON d.id = c."departmentId"
      WHERE c."organizationId" = $1 AND c."assignedToId" = $2
        AND c.status = 'OPEN' AND c."hasError" = false
        AND (c."hasHumanReply" = false OR c."lastMessageDirection" = 'in')
      GROUP BY 1 ORDER BY 2 DESC`,
    [ORG, user.id],
  );
  const globalNow = nowRows.reduce((s, r) => s + r.n, 0);
  console.log(`\n[3] Fila contada agora (todos os dias): ${globalNow}`);
  for (const r of nowRows) {
    const flag =
      cfg.queueLimit > 0 && r.n < cfg.queueLimit && globalNow >= cfg.queueLimit
        ? "  <- abaixo do teto isoladamente: ainda aceita lead neste depto"
        : "";
    console.log(`    ${String(r.n).padStart(4)}  ${r.dept}${flag}`);
  }
  if (cfg.queueLimit > 0 && globalNow >= cfg.queueLimit && nowRows.length > 1) {
    console.log(
      `\n    Global (${globalNow}) já atingiu o teto (${cfg.queueLimit}), mas nenhum` +
        `\n    departamento sozinho atingiu — distribuição departamental ainda o` +
        `\n    considera elegível.`,
    );
  }

  // 4) Total aberto ignorando o critério "vez dele" — a carga que ele
  //    realmente carrega.
  const { rows: allOpen } = await client.query(
    `SELECT COUNT(*)::int AS n FROM conversations
      WHERE "organizationId" = $1 AND "assignedToId" = $2 AND status = 'OPEN'`,
    [ORG, user.id],
  );
  console.log(
    `\n[4] Conversas OPEN atribuídas a ele, sem nenhum filtro: ${allOpen[0].n}`,
  );
  console.log(
    `    Diferença para [3] = conversas que ele carrega mas que o limite ignora.`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
