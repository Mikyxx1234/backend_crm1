// Após aplicar a baseline 20240101000000_init, marca todas as 41 migrations
// subsequentes como "applied" — o schema do banco já equivale ao estado final
// porque a baseline foi gerada a partir do schema.prisma atual (que inclui
// todas as colunas/tabelas que essas 41 migrations adicionariam).
//
// Usa `prisma migrate resolve --applied <nome>`. Roda em série; cada chamada
// é um round-trip de ~1s mas é a forma oficialmente suportada (calcula
// checksum correto, marca finished_at = NOW(), etc.).
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "prisma/migrations");
const BASELINE = "20240101000000_init";

const all = readdirSync(root)
  .filter((d) => statSync(path.join(root, d)).isDirectory())
  .sort();

const toResolve = all.filter((d) => d !== BASELINE);
console.log(`>> Total migrations: ${all.length}`);
console.log(`>> Baseline (pular): ${BASELINE}`);
console.log(`>> A marcar como applied: ${toResolve.length}\n`);

let ok = 0;
let fail = 0;
for (const name of toResolve) {
  process.stdout.write(`  - ${name} ... `);
  try {
    execSync(
      `npx prisma migrate resolve --applied ${name} --schema=./prisma/schema.prisma`,
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    console.log("OK");
    ok++;
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    if (stderr.includes("is already recorded as applied")) {
      console.log("já aplicada (ignorando)");
      ok++;
    } else {
      console.log("FALHOU");
      console.log("    " + stderr.split("\n").slice(0, 5).join("\n    "));
      fail++;
    }
  }
}

console.log(`\n>> Resultado: ${ok} ok, ${fail} falhas`);
process.exit(fail === 0 ? 0 : 1);
