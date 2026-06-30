/**
 * Testes unitários de normalizePhone e phonesMatch.
 * Funções puras — sem mocks necessários.
 */
import { describe, expect, it } from "vitest";

import { normalizePhone, phonesMatch } from "@/lib/phone";

// ── normalizePhone ────────────────────────────────────────────────────────

describe("normalizePhone — formatos brasileiros", () => {
  it("formato com parênteses, espaço e hífen → E.164", () => {
    expect(normalizePhone("(11) 9 8765-4321")).toBe("+5511987654321");
  });

  it("11 dígitos sem DDI (DDD + 9º dígito + 8) → E.164", () => {
    expect(normalizePhone("11987654321")).toBe("+5511987654321");
  });

  it("com DDI +55 já presente → mesmo E.164", () => {
    expect(normalizePhone("+5511987654321")).toBe("+5511987654321");
  });

  it("com DDI 55 sem sinal → E.164", () => {
    expect(normalizePhone("5511987654321")).toBe("+5511987654321");
  });

  it("sem 9º dígito: 10 dígitos (DDD + 8) → E.164", () => {
    expect(normalizePhone("1133334444")).toBe("+551133334444");
  });

  it("sem 9º dígito com DDI: 12 dígitos → E.164", () => {
    expect(normalizePhone("551133334444")).toBe("+551133334444");
  });

  it("formato com pontos → E.164", () => {
    expect(normalizePhone("11.9.8765.4321")).toBe("+5511987654321");
  });

  it("todos os formatos para o mesmo número → mesmo E.164", () => {
    const expected = "+5511987654321";
    const variants = [
      "(11) 9 8765-4321",
      "11987654321",
      "+5511987654321",
      "5511987654321",
    ];
    for (const v of variants) {
      expect(normalizePhone(v), `variante: ${v}`).toBe(expected);
    }
  });
});

describe("normalizePhone — lixo / entradas inválidas → null", () => {
  it("null → null", () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("string vazia → null", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("só letras/lixo → null", () => {
    expect(normalizePhone("abc-xyz")).toBeNull();
  });

  it("muito curto (3 dígitos) → null", () => {
    expect(normalizePhone("123")).toBeNull();
  });

  it("só espaços → null", () => {
    expect(normalizePhone("   ")).toBeNull();
  });
});

// ── phonesMatch ───────────────────────────────────────────────────────────

describe("phonesMatch", () => {
  it("mesmo número em formatos diferentes → true", () => {
    expect(phonesMatch("(11) 9 8765-4321", "+5511987654321")).toBe(true);
    expect(phonesMatch("11987654321", "5511987654321")).toBe(true);
    expect(phonesMatch("+5511987654321", "11987654321")).toBe(true);
  });

  it("DDDs diferentes → false", () => {
    expect(phonesMatch("(11) 9 8765-4321", "(21) 9 8765-4321")).toBe(false);
  });

  it("números diferentes → false", () => {
    expect(phonesMatch("+5511987654321", "+5511987654322")).toBe(false);
  });

  it("null → false (qualquer posição)", () => {
    expect(phonesMatch(null, "+5511987654321")).toBe(false);
    expect(phonesMatch("+5511987654321", null)).toBe(false);
    expect(phonesMatch(null, null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(phonesMatch(undefined, "+5511987654321")).toBe(false);
    expect(phonesMatch(undefined, undefined)).toBe(false);
  });

  it("lixo inválido → false", () => {
    expect(phonesMatch("abc", "+5511987654321")).toBe(false);
    expect(phonesMatch("abc", "xyz")).toBe(false);
  });

  it("sem 9º dígito: mesmos números em formatos diferentes → true", () => {
    expect(phonesMatch("1133334444", "+551133334444")).toBe(true);
  });
});
