/**
 * Helpers para resolver o NOME de exibição de um contato nos exports.
 *
 * Motivação: importações antigas gravaram o TELEFONE no campo `name` de
 * milhares de contatos (o nome real acabou no título do negócio). Para que
 * os exports NUNCA mostrem telefone na coluna "Nome", usamos um fallback:
 * se o nome parece um placeholder (telefone ou "Lead ..."), tentamos um
 * nome alternativo (ex.: o título do negócio) que seja um nome real.
 */

const PHONE_LIKE = /^[\s+()\-\d]+$/;
const HAS_LETTER = /[A-Za-zÀ-ÿ]/;

/** `true` se a string é só caracteres de telefone com 6+ dígitos. */
export function looksLikePhone(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  if (!t) return false;
  return PHONE_LIKE.test(t) && t.replace(/\D/g, "").length >= 6;
}

/** `true` se a string é um nome real (tem letra e não é "Negócio ..."). */
export function isRealName(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  return HAS_LETTER.test(t) && !/^neg[oó]cio/i.test(t);
}

/**
 * Extrai o nome da pessoa a partir de um título de negócio
 * ("Negócio Marcelo Pinheiro" / "Negócio - Marcelo" → "Marcelo Pinheiro").
 * Retorna null para placeholders ("Negócio - #12") ou quando não há prefixo.
 */
export function personNameFromDealTitle(
  title: string | null | undefined,
): string | null {
  if (!title) return null;
  const t = title.trim();
  if (!t) return null;
  const m = t.match(/^neg[oó]cio(?:\s*[-–]\s*|\s+)(.+)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest || /^#?\d+$/.test(rest)) return null;
  return rest;
}

/**
 * Remove emojis/decoradores do nome (ex.: "🌻🌵 Jéssica" → "Jéssica").
 * Preserva letras acentuadas. Usa Extended_Pictographic + ZWJ/VS16.
 */
export function stripNameDecorators(name: string): string {
  return name
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Garante que o nome do CONTATO não carregue o prefixo "Negócio"
 * nem emojis/decoradores.
 * Contato = "Marcelo Pinheiro"; Negócio = "Negócio Marcelo Pinheiro".
 */
export function sanitizeContactName(
  name: string | null | undefined,
): string {
  const t = (name ?? "").trim();
  if (!t) return t;
  const withoutDeal = personNameFromDealTitle(t) ?? t;
  return stripNameDecorators(withoutDeal);
}

/** Título padrão do negócio a partir do nome do contato. */
export function defaultDealTitleForContact(
  contactName: string | null | undefined,
): string | null {
  const person = sanitizeContactName(contactName);
  if (!person || !isRealName(person)) return null;
  return `Negócio ${person}`;
}

/** `true` se o nome é um placeholder (telefone ou "Lead ...") — não usável. */
export function isPlaceholderName(s: string | null | undefined): boolean {
  if (!s) return true;
  const t = s.trim();
  if (!t) return true;
  if (looksLikePhone(t)) return true;
  if (/^lead\b/i.test(t)) return true;
  return false;
}

/**
 * Retorna o melhor nome de exibição: usa `name` se for um nome utilizável;
 * caso contrário, o primeiro `fallback` que seja um nome real; se nenhum
 * servir, devolve o `name` original (não perde dado).
 */
export function resolveContactDisplayName(
  name: string | null | undefined,
  ...fallbacks: (string | null | undefined)[]
): string {
  const n = (name ?? "").trim();
  if (n && !isPlaceholderName(n)) return n;
  for (const f of fallbacks) {
    const ft = (f ?? "").trim();
    if (ft && isRealName(ft)) return ft;
  }
  return n;
}
