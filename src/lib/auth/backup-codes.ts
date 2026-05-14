import { randomBytes } from "node:crypto";
import { hash, compare } from "bcryptjs";

/**
 * Codigos de backup MFA (PR 4.1).
 *
 * Sao usados quando o usuario perde o autenticador. Cada codigo e
 * single-use: ao consumir marcamos `usedAt`. Geramos 10 por padrao.
 *
 * Armazenamos APENAS o hash (bcrypt). O usuario ve o codigo em
 * plaintext UMA VEZ (na hora de gerar) — depois disso, perdido = nao
 * dah pra recuperar. Tem que regenerar set inteiro (invalida todos os
 * codigos antigos).
 *
 * Formato exibido: 4 grupos de 4 chars (ex.: `A2B4-C6D8-E0F2-G4H6`).
 * Total: 16 chars alfanumericos = ~96 bits de entropia. Mais que
 * suficiente — codigos sao single-use e o brute-force exigiria
 * adivinhar antes de o user usar.
 *
 * @see docs/mfa-totp.md
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I (legibilidade)
const CODE_GROUPS = 4;
const CODE_GROUP_SIZE = 4;
const BACKUP_CODES_COUNT = 10;
const BCRYPT_ROUNDS = 10;

function randomCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    let part = "";
    const buf = randomBytes(CODE_GROUP_SIZE);
    for (let i = 0; i < CODE_GROUP_SIZE; i++) {
      part += ALPHABET[buf[i] % ALPHABET.length];
    }
    groups.push(part);
  }
  return groups.join("-");
}

/**
 * Gera N codigos plaintext + os hashes para persistir.
 * O caller deve persistir os hashes e mostrar APENAS os plaintext na UI.
 */
export async function generateBackupCodes(
  count: number = BACKUP_CODES_COUNT,
): Promise<{ plaintexts: string[]; hashes: string[] }> {
  const plaintexts: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomCode();
    plaintexts.push(code);
    hashes.push(await hash(code, BCRYPT_ROUNDS));
  }
  return { plaintexts, hashes };
}

/**
 * Normaliza input do usuario antes de comparar: remove espacos,
 * converte pra uppercase. Aceita com ou sem hifens.
 */
export function normalizeBackupCode(input: string): string {
  const cleaned = input.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z0-9]{16}$/.test(cleaned)) {
    // sem hifens — re-formatamos pra comparar com os emitidos
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}`;
  }
  return cleaned;
}

/**
 * Verifica se um codigo (plaintext) bate com algum dos hashes
 * armazenados. Retorna o INDEX do match ou -1.
 *
 * O caller deve marcar `usedAt` no registro correspondente.
 */
export async function findMatchingBackupCode(
  candidate: string,
  hashes: ReadonlyArray<string>,
): Promise<number> {
  const normalized = normalizeBackupCode(candidate);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    return -1;
  }
  for (let i = 0; i < hashes.length; i++) {
    if (await compare(normalized, hashes[i])) return i;
  }
  return -1;
}

export const BACKUP_CODES_DEFAULT_COUNT = BACKUP_CODES_COUNT;
