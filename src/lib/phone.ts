/**
 * Utilitários de normalização de número de telefone para o formato E.164.
 *
 * Foco Brasil (DDI +55):
 *   - Aceita com ou sem DDI `+55` / `55`
 *   - Aceita DDD de 2 dígitos (11–99)
 *   - Aceita 8 ou 9 dígitos no número local (com ou sem 9º dígito)
 *   - Remove qualquer máscara: espaços, parênteses, hífens, pontos
 *
 * Números com DDI diferente de 55 são aceitos e retornados com o `+`
 * prefixado, sem normalização regional adicional.
 *
 * Sem dependências externas — implementação manual para manter o bundle
 * leve e o código testável sem setup extra.
 */

/** Regex que valida E.164 final: `+` seguido de 7–15 dígitos. */
const E164_RE = /^\+\d{7,15}$/;

/**
 * Remove todos os caracteres que não sejam dígito ou `+` no início.
 */
function strip(raw: string): string {
  // Mantém apenas dígitos e um possível `+` na primeira posição.
  return raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

/**
 * Normaliza um número de telefone brasileiro para o formato E.164
 * (`+55DDXXXXXXXXX` ou `+55DDXXXXXXXXXX` com 9º dígito).
 *
 * @param raw - Número em qualquer formato livre (ex.: "(11) 9 8765-4321",
 *              "11987654321", "+5511987654321", "5511987654321").
 * @returns String no formato E.164 (ex.: "+5511987654321") ou `null` se
 *          o número não puder ser normalizado.
 *
 * @example
 * normalizePhone("(11) 9 8765-4321") // "+5511987654321"
 * normalizePhone("+5511987654321")   // "+5511987654321"
 * normalizePhone("11987654321")      // "+5511987654321"
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const s = strip(raw.trim());
  if (!s) return null;

  // Já está em E.164 completo
  if (E164_RE.test(s)) return s;

  // Extrai apenas os dígitos (sem `+`)
  const digits = s.startsWith("+") ? s.slice(1) : s;

  // ── Tratamento Brasil ──────────────────────────────────────────────────
  // Formatos possíveis de entrada (somente dígitos):
  //   55 11 9XXXXXXXX  → 13 dígitos (DDI + DDD + 9 dígitos com 9º)
  //   55 11 XXXXXXXX   → 12 dígitos (DDI + DDD + 8 dígitos sem 9º)
  //   11 9XXXXXXXX     → 11 dígitos (DDD + 9 dígitos com 9º)
  //   11 XXXXXXXX      → 10 dígitos (DDD + 8 dígitos sem 9º)
  //   9XXXXXXXX        →  9 dígitos (9 dígitos com 9º, sem DDD — não normalizável)
  //   XXXXXXXX         →  8 dígitos (sem DDD — não normalizável)

  if (digits.startsWith("55")) {
    const local = digits.slice(2); // Remove DDI
    return normalizeBrLocal(local);
  }

  // Sem DDI mas com DDD (10 ou 11 dígitos)
  if (digits.length === 10 || digits.length === 11) {
    return normalizeBrLocal(digits);
  }

  // Número estrangeiro: retorna com `+` se tiver entre 7 e 15 dígitos
  if (digits.length >= 7 && digits.length <= 15) {
    const candidate = `+${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }

  return null;
}

/**
 * Normaliza a parte local de um número BR (sem DDI) para E.164.
 * Espera 8–11 dígitos: DDD (2) + número (8 ou 9).
 *
 * @internal
 */
function normalizeBrLocal(local: string): string | null {
  // DDD + 9 dígitos (com 9º)  → 11 dígitos
  // DDD + 8 dígitos (sem 9º)  → 10 dígitos
  if (local.length === 11 || local.length === 10) {
    return `+55${local}`;
  }
  return null;
}

/** Separadores usados por planilhas e CRMs de origem para juntar dois números. */
const MULTI_NUMBER_SPLIT_RE = /[,;/|]+|\s+e\s+/i;

/**
 * Quebra uma entrada em candidatos e devolve os que normalizam para E.164.
 *
 * Base de `parseContactPhoneInput` (rejeita) e do backfill (recupera o
 * primeiro). Como `normalizePhone` já descarta tudo que não é dígito, um
 * candidato sujo como `"+5511958101572languageSalesforce"` ainda é
 * recuperado — o que atrapalha é só a presença de DOIS números na mesma
 * string, que vira um amontoado de 20+ dígitos.
 */
export function extractPhoneCandidates(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(MULTI_NUMBER_SPLIT_RE)) {
    const normalized = normalizePhone(part);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export type PhoneParseResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

/**
 * Valida o telefone recebido pelas rotas de escrita de contato.
 *
 * Motivo (04/ago/26): `normalizeContactPhoneInput` gravava o valor cru quando
 * a normalização falhava, sob a premissa de "não descartar entrada do
 * usuário". Na prática as integrações não são usuário: 32 contatos da org
 * Cruzeiro EaD acabaram com telefones como `"+5585991940125, +558591940125"`,
 * `"+5511958101572languageSalesforce, +5511958101572"` e até `"Farmácia"`.
 * Nenhum deles é discável — e o envio de WhatsApp faz `replace(/\D/g, "")`,
 * então viram um número de 25 dígitos que a Meta rejeita. O contato fica
 * silenciosamente inalcançável, que é o pior desfecho possível.
 *
 * Falhar alto na borda transforma isso em erro visível no node do n8n, no
 * momento em que dá para corrigir a origem.
 *
 * Aceita com ou sem `+`, com ou sem DDI 55, e com qualquer máscara —
 * `+5511999998888`, `5511999998888`, `11999998888` e `(11) 99999-8888`
 * chegam todos ao mesmo E.164. String vazia limpa o campo (`null`).
 */
export function parseContactPhoneInput(raw: string | null | undefined): PhoneParseResult {
  if (raw == null) return { ok: true, value: null };

  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };

  const normalized = normalizePhone(trimmed);
  if (normalized) return { ok: true, value: normalized };

  // Não adivinhamos qual número o remetente queria, mas dizemos quais
  // reconhecemos: é a diferença entre o operador corrigir a origem em 10
  // segundos e abrir um chamado.
  const candidates = extractPhoneCandidates(trimmed);
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: `Telefone inválido: "${trimmed}" contém mais de um número (${candidates.join(", ")}). Envie apenas um.`,
    };
  }
  if (candidates.length === 1) {
    return {
      ok: false,
      reason: `Telefone inválido: "${trimmed}" tem caracteres a mais. Envie apenas "${candidates[0]}".`,
    };
  }

  return {
    ok: false,
    reason: `Telefone inválido: "${trimmed}". Envie um único número com DDD, com ou sem +55 — ex.: +5511999998888, 5511999998888 ou 11999998888.`,
  };
}

/**
 * Verifica se dois números de telefone são equivalentes após normalização.
 *
 * Útil para o vínculo chamada→contato sem exigir formato fixo no banco.
 *
 * @param a - Primeiro número (qualquer formato).
 * @param b - Segundo número (qualquer formato).
 * @returns `true` se ambos normalizam para o mesmo E.164; `false`
 *          se diferentes **ou** se algum não puder ser normalizado.
 *
 * @example
 * phonesMatch("(11) 9 8765-4321", "+5511987654321") // true
 * phonesMatch("(11) 9 8765-4321", "(21) 9 8765-4321") // false
 */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Gera as variantes E.164 equivalentes de um número, cobrindo a
 * ambiguidade do **9º dígito** dos celulares brasileiros.
 *
 * No Brasil, o mesmo celular pode aparecer com ou sem o "9" após o DDD
 * (ex.: `+5511987654321` ↔ `+551187654321`). Bases importadas de sistemas
 * antigos (ou o próprio wa_id da Meta em números legados) misturam os dois
 * formatos. Este helper devolve TODAS as formas que devem ser tratadas como
 * o mesmo contato, para usar num `where: { phone: { in: variants } }`.
 *
 * - Número não-BR ou não normalizável → devolve só a forma normalizada (ou []).
 * - Celular BR com 9º dígito (DDD + 9XXXXXXXX) → adiciona a forma sem o 9.
 * - Número BR de 8 dígitos iniciando em 6–9 (celular antigo) → adiciona a
 *   forma com o 9º dígito.
 *
 * @example
 * phoneMatchVariants("+5511987654321") // ["+5511987654321", "+551187654321"]
 * phoneMatchVariants("11987654321")    // ["+5511987654321", "+551187654321"]
 * phoneMatchVariants("(11) 8765-4321") // ["+551187654321", "+5511987654321"]
 */
export function phoneMatchVariants(raw: string | null | undefined): string[] {
  const n = normalizePhone(raw);
  if (!n) return [];
  const variants = new Set<string>([n]);

  if (n.startsWith("+55")) {
    const local = n.slice(3); // DDD (2) + assinante
    const ddd = local.slice(0, 2);
    const sub = local.slice(2);
    if (sub.length === 9 && sub.startsWith("9")) {
      // Celular com 9º dígito → forma sem o 9.
      variants.add(`+55${ddd}${sub.slice(1)}`);
    } else if (sub.length === 8 && /^[6-9]/.test(sub)) {
      // Celular antigo de 8 dígitos → forma com o 9º dígito.
      variants.add(`+55${ddd}9${sub}`);
    }
  }

  return [...variants];
}
