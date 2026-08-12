/**
 * Redefine a senha de TODOS os operadores (users HUMAN, nao-erased) de uma org.
 * Senha gerada = Nome + Sobrenome + digitos aleatorios (facil de digitar).
 * Hash: bcrypt cost 10 (mesmo do login em src/lib/auth.ts).
 *
 * Uso:
 *   node reset-operadores-senha.mjs <orgId>            # DRY-RUN (so mostra)
 *   node reset-operadores-senha.mjs <orgId> --apply    # aplica no banco
 *
 * Requer .env.local com DATABASE_URL (mesmo padrao dos outros scripts).
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carrega .env.local manualmente
try {
  const envFile = readFileSync(resolve(__dirname, ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn("Aviso: .env.local nao encontrado, usando env existente");
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

const orgId = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!orgId) {
  console.error("Uso: node reset-operadores-senha.mjs <orgId> [--apply]");
  process.exit(1);
}

// Remove acentos, espacos e caracteres nao alfanumericos.
function clean(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "");
}

function cap(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Ex.: "Marcelo Silva Souza" -> "MarceloSilva8427"
function genPassword(name) {
  const parts = clean(name).length ? name.trim().split(/\s+/) : ["Operador"];
  const first = cap(clean(parts[0])) || "Operador";
  const last = parts.length > 1 ? cap(clean(parts[parts.length - 1])) : "";
  const digits = String(Math.floor(1000 + Math.random() * 9000)); // 4 digitos
  return `${first}${last}${digits}`;
}

async function main() {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) {
    console.error(`Org '${orgId}' nao encontrada.`);
    process.exit(1);
  }
  console.log(`Org: ${org.name} (slug=${org.slug}, id=${org.id})`);
  console.log(APPLY ? "MODO: APLICAR\n" : "MODO: DRY-RUN (nada sera gravado)\n");

  const operadores = await prisma.user.findMany({
    where: {
      organizationId: org.id,
      type: "HUMAN",
      isErased: false,
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });

  if (!operadores.length) {
    console.log("Nenhum operador (HUMAN) encontrado nessa org.");
    return;
  }

  const results = [];
  for (const u of operadores) {
    const senha = genPassword(u.name);
    if (APPLY) {
      const hashedPassword = await bcrypt.hash(senha, 10);
      await prisma.user.update({
        where: { id: u.id },
        data: { hashedPassword },
      });
    }
    results.push({ nome: u.name, email: u.email, role: u.role, senha });
  }

  console.log("Lista de operadores e novas senhas:\n");
  console.table(results.map((r) => ({ Nome: r.nome, Email: r.email, Role: r.role, Senha: r.senha })));

  // Salva um arquivo local para entrega segura.
  const outPath = resolve(__dirname, `senhas-operadores-${org.slug || org.id}.txt`);
  const lines = results.map((r) => `${r.nome}\t${r.email}\t${r.role}\t${r.senha}`);
  writeFileSync(outPath, `Org: ${org.name} (${org.id})\nGerado: ${new Date().toISOString()}\n\nNome\tEmail\tRole\tSenha\n${lines.join("\n")}\n`, "utf-8");
  console.log(`\nArquivo salvo: ${outPath}`);

  if (!APPLY) {
    console.log("\n>> DRY-RUN: rode novamente com --apply para gravar no banco.");
  } else {
    console.log(`\n✅ ${results.length} senha(s) atualizada(s).`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
