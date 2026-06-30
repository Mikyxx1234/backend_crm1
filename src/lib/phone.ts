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
