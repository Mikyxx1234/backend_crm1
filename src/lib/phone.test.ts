/**
 * Testes unitários de normalizePhone e phonesMatch.
 * Funções puras — sem mocks necessários.
 */
import { describe, expect, it } from "vitest";

import {
  extractPhoneCandidates,
  normalizePhone,
  parseContactPhoneInput,
  phonesMatch,
} from "@/lib/phone";

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

// ── parseContactPhoneInput ────────────────────────────────────────────────
//
// Os casos inválidos abaixo são amostras reais colhidas na org Cruzeiro EaD
// em 04/ago/26, quando 32 contatos foram encontrados com telefone impossível
// de discar — todos gravados por integração antes desta validação existir.

describe("parseContactPhoneInput — aceita com ou sem +, DDI e máscara", () => {
  it("normaliza as variantes do mesmo número", () => {
    for (const raw of [
      "+5511999998888",
      "5511999998888",
      "11999998888",
      "(11) 99999-8888",
      "  +55 11 99999 8888  ",
    ]) {
      const r = parseContactPhoneInput(raw);
      expect(r, `variante: ${raw}`).toEqual({ ok: true, value: "+5511999998888" });
    }
  });

  it("ausência de telefone limpa o campo em vez de falhar", () => {
    expect(parseContactPhoneInput(null)).toEqual({ ok: true, value: null });
    expect(parseContactPhoneInput(undefined)).toEqual({ ok: true, value: null });
    expect(parseContactPhoneInput("")).toEqual({ ok: true, value: null });
    expect(parseContactPhoneInput("   ")).toEqual({ ok: true, value: null });
  });
});

describe("parseContactPhoneInput — rejeita o que não é discável", () => {
  it("dois números na mesma string: aponta os dois no erro", () => {
    const r = parseContactPhoneInput("+5585991940125, +558591940125");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("mais de um número");
    expect(r.reason).toContain("+5585991940125");
    expect(r.reason).toContain("+558591940125");
  });

  it("números distintos separados por vírgula", () => {
    const r = parseContactPhoneInput("+5511984347701, +55 11 94953-3202");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("mais de um número");
  });

  it("sujeira colada no número: sugere a forma limpa", () => {
    const r = parseContactPhoneInput("+5511958101572languageSalesforce, +5511958101572");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('Envie apenas "+5511958101572"');
  });

  it("texto livre no campo telefone", () => {
    for (const raw of ["Farmácia", "Perícia Judicial E Extrajudicial"]) {
      const r = parseContactPhoneInput(raw);
      expect(r.ok, `entrada: ${raw}`).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toContain("Telefone inválido");
    }
  });

  it("número curto demais para ser um telefone", () => {
    expect(parseContactPhoneInput("123").ok).toBe(false);
  });
});

describe("extractPhoneCandidates", () => {
  it("separa por vírgula, ponto e vírgula, barra e ' e '", () => {
    expect(extractPhoneCandidates("11999998888; 11977776666")).toEqual([
      "+5511999998888",
      "+5511977776666",
    ]);
    expect(extractPhoneCandidates("11999998888 / 11977776666")).toHaveLength(2);
    expect(extractPhoneCandidates("11999998888 e 11977776666")).toHaveLength(2);
  });

  it("deduplica o mesmo número repetido", () => {
    expect(extractPhoneCandidates("+5511948123760, +5511948123760")).toEqual([
      "+5511948123760",
    ]);
  });

  it("string sem nenhum número → lista vazia", () => {
    expect(extractPhoneCandidates("Farmácia")).toEqual([]);
  });
});
