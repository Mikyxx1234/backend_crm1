/**
 * Script one-shot: lê todos os `.dc` em `Bots/`, chama `parseDigisacBot`
 * em cada um e gera `src/lib/automation-templates-imported.ts` com os
 * templates prontos pra entrar no catálogo.
 *
 * Uso:
 *   npx tsx src/scripts/import-bots-dc.ts
 *
 * O arquivo gerado é idempotente: pode ser re-rodado sempre que chegarem
 * novos exports. Também imprime no stdout um resumo (nº blocos, reviews)
 * pra auditar a qualidade da conversão.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseDigisacBot,
  type DigisacBotExport,
  type DigisacParseResult,
  type ParsedDigisacTemplate,
} from "../lib/digisac-bot-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const BOTS_DIR = path.join(REPO_ROOT, "Bots");
const OUT_FILE = path.join(REPO_ROOT, "src/lib/automation-templates-imported.ts");

// ─── Lê todos os .dc ─────────────────────────────────────────────

function listDcFiles(): string[] {
  if (!fs.existsSync(BOTS_DIR)) return [];
  return fs
    .readdirSync(BOTS_DIR)
    .filter((f) => f.endsWith(".dc"))
    .map((f) => path.join(BOTS_DIR, f));
}

function readBot(filePath: string): DigisacBotExport {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as DigisacBotExport;
}

// ─── Geração do arquivo TS ───────────────────────────────────────

/** Ícones lucide que o arquivo gerado pode importar. */
const ALLOWED_ICONS = new Set([
  "Sparkles",
  "UserPlus",
  "HandCoins",
  "GraduationCap",
  "HeartHandshake",
  "Snowflake",
  "Headphones",
  "RefreshCcw",
  "HandHeart",
  "BadgePercent",
  "BookOpen",
  "Play",
  "Bot",
]);

function sanitizeIcon(name: string): string {
  return ALLOWED_ICONS.has(name) ? name : "Bot";
}

function toTsLiteral(value: unknown, indent = 2): string {
  const pad = (n: number) => " ".repeat(n);
  const stringify = (v: unknown, level: number): string => {
    if (v === null) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "bigint") return `${v}n`;
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      const items = v.map((it) => `${pad(level + indent)}${stringify(it, level + indent)}`);
      return `[\n${items.join(",\n")},\n${pad(level)}]`;
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) return "{}";
      const lines = entries.map(([k, val]) => {
        const key = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
        return `${pad(level + indent)}${key}: ${stringify(val, level + indent)}`;
      });
      return `{\n${lines.join(",\n")},\n${pad(level)}}`;
    }
    return "null";
  };
  return stringify(value, 0);
}

function templateToTs(parsed: ParsedDigisacTemplate, varName: string): string {
  const iconName = sanitizeIcon(parsed.iconName);
  const { iconName: _omit, ...rest } = parsed;
  void _omit;
  // Monta o objeto com `icon: IconName` (não é string, é referência)
  const body = toTsLiteral(rest, 2);
  // Inserir `icon:` na posição correta — substituímos a primeira ocorrência
  // de `category:` adicionando `icon:` logo depois (mantém ordem agradável)
  const withIcon = body.replace(
    /(category: "[^"]+",)/,
    `$1\n  icon: ${iconName},`,
  );
  return `const ${varName}: AutomationTemplate = ${withIcon};`;
}

function buildFile(results: Array<{ file: string; parsed: DigisacParseResult }>): string {
  const now = new Date().toISOString();
  const icons = new Set<string>();
  results.forEach((r) => icons.add(sanitizeIcon(r.parsed.template.iconName)));
  const iconList = Array.from(icons).sort().join(",\n  ");

  const varNames: string[] = [];
  const bodies: string[] = [];
  const summaries: string[] = [];

  results.forEach(({ file, parsed }, i) => {
    const vn = `T_IMPORTED_${String(i + 1).padStart(2, "0")}`;
    varNames.push(vn);
    const header = [
      `// ─────────────────────────────────────────────────────────────`,
      `// ${path.basename(file)}`,
      `// Bot original: "${parsed.template.name}" — ${parsed.stats.totalBlocks} blocos`,
      `// Steps gerados: ${parsed.template.automation.steps.length}`,
      parsed.reviews.length > 0
        ? `// ⚠️ Revisar (${parsed.reviews.length}):\n${parsed.reviews.map((r) => `//   - ${r}`).join("\n")}`
        : `// ✅ Sem warnings.`,
      `// ─────────────────────────────────────────────────────────────`,
    ].join("\n");
    bodies.push(`${header}\n${templateToTs(parsed.template, vn)}`);

    summaries.push(
      `  • ${path.basename(file).slice(0, 32).padEnd(34)} → ${parsed.template.name.padEnd(30)} [${parsed.template.automation.steps.length.toString().padStart(2)} steps, ${parsed.reviews.length} warn]`,
    );
  });

  return `/**
 * Catálogo gerado automaticamente a partir dos arquivos \`.dc\` em \`Bots/\`.
 * NÃO EDITE À MÃO — rode \`npx tsx src/scripts/import-bots-dc.ts\` para
 * regenerar. A lista é mesclada em \`automation-templates.ts\`.
 *
 * Gerado em: ${now}
 * Bots importados: ${results.length}
 *
 * Resumo:
${summaries.join("\n")}
 */

import {
  ${iconList},
} from "lucide-react";

import type { AutomationTemplate } from "./automation-templates";

${bodies.join("\n\n")}

export const IMPORTED_AUTOMATION_TEMPLATES: AutomationTemplate[] = [
${varNames.map((n) => `  ${n},`).join("\n")}
];
`;
}

// ─── Runner ───────────────────────────────────────────────────────

function main() {
  const files = listDcFiles();
  if (files.length === 0) {
    console.warn(`[import-bots-dc] Nenhum .dc encontrado em ${BOTS_DIR}`);
    return;
  }
  console.log(`[import-bots-dc] Processando ${files.length} arquivo(s)…`);

  const results: Array<{ file: string; parsed: DigisacParseResult }> = [];
  for (const file of files) {
    try {
      const bot = readBot(file);
      const parsed = parseDigisacBot(bot);
      results.push({ file, parsed });
      const warn = parsed.reviews.length > 0 ? ` (${parsed.reviews.length} warn)` : "";
      console.log(
        `  ✓ ${path.basename(file).slice(0, 40)} → ${parsed.template.name} — ${parsed.template.automation.steps.length} steps${warn}`,
      );
    } catch (err) {
      console.error(`  ✗ ${path.basename(file)}: ${(err as Error).message}`);
    }
  }

  const content = buildFile(results);
  fs.writeFileSync(OUT_FILE, content, "utf-8");
  console.log(`\n[import-bots-dc] Escrito ${path.relative(REPO_ROOT, OUT_FILE)} (${results.length} templates).`);
}

main();
