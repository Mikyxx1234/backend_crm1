/**
 * Testes do helper de agrupamento de campos personalizados.
 * Cobre os CAs do PRD Agrupamento de Campos na Aside:
 *   CA-01: fallback flat quando não há grupo configurado
 *   CA-03: bucket virtual "Outros campos" para órfãos
 *   CA-05: ordem dos grupos e dos campos dentro do grupo
 *   CA-07: tolera IDs de campos que não existem mais
 *   CA-08: isolamento por entidade (contact/deal)
 */
import { describe, expect, it } from "vitest";

import {
  resolveCustomFieldGroups,
  type CustomFieldDef,
  type SectionConfig,
} from "@/lib/field-layout";

const F = (id: string, label: string): CustomFieldDef => ({
  id,
  name: id,
  label,
  type: "TEXT",
});

const group = (
  id: string,
  entity: "contact" | "deal",
  label: string,
  fields: { id: string; label?: string; hidden?: boolean }[],
  extra: Partial<SectionConfig> = {},
): SectionConfig => ({
  id,
  label,
  kind: "custom_fields_group",
  entity,
  fields: fields.map((f) => ({ id: f.id, label: f.label ?? f.id, hidden: f.hidden })),
  ...extra,
});

describe("resolveCustomFieldGroups", () => {
  it("CA-01 — sem grupos configurados → retorna bucket virtual único com todos os campos", () => {
    const cf = [F("a", "A"), F("b", "B")];
    const out = resolveCustomFieldGroups([], cf, "deal");
    expect(out).toHaveLength(1);
    expect(out[0].group).toBeNull();
    expect(out[0].fields.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("CA-01 — sem campos e sem grupos → retorna vazio (não gera bucket virtual)", () => {
    expect(resolveCustomFieldGroups([], [], "deal")).toEqual([]);
  });

  it("CA-03 — órfãos vão para bucket virtual ao final", () => {
    const cf = [F("a", "A"), F("b", "B"), F("c", "C")];
    const sections = [group("g1", "deal", "Docs", [{ id: "a" }])];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    expect(out).toHaveLength(2);
    expect(out[0].group?.id).toBe("g1");
    expect(out[0].fields.map((f) => f.id)).toEqual(["a"]);
    expect(out[1].group).toBeNull();
    expect(out[1].fields.map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("CA-05 — grupos preservam ordem definida no layout, e ordem dos fields dentro do grupo", () => {
    const cf = [F("a", "A"), F("b", "B"), F("c", "C"), F("d", "D")];
    const sections = [
      group("g2", "deal", "Segundo", [{ id: "c" }, { id: "a" }]),
      group("g1", "deal", "Primeiro", [{ id: "d" }, { id: "b" }]),
    ];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    expect(out.map((r) => r.group?.id)).toEqual(["g2", "g1"]);
    expect(out[0].fields.map((f) => f.id)).toEqual(["c", "a"]);
    expect(out[1].fields.map((f) => f.id)).toEqual(["d", "b"]);
  });

  it("CA-07 — tolera fields excluídos: IDs desconhecidos são silenciosamente ignorados", () => {
    const cf = [F("a", "A")];
    const sections = [
      group("g1", "deal", "Docs", [{ id: "a" }, { id: "ghost" }, { id: "gone" }]),
    ];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    expect(out).toHaveLength(1);
    expect(out[0].fields.map((f) => f.id)).toEqual(["a"]);
  });

  it("CA-07 — grupo que ficou sem fields visíveis é omitido, mesmo antes de órfãos", () => {
    const cf = [F("b", "B")];
    const sections = [
      group("empty", "deal", "Vazio", [{ id: "ghost" }]),
      group("g1", "deal", "Com campo", [{ id: "b" }]),
    ];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    expect(out.map((r) => r.group?.id)).toEqual(["g1"]);
  });

  it("CA-08 — isolamento por entidade: grupos de contact não vazam no deal", () => {
    const cf = [F("a", "A"), F("b", "B")];
    const sections = [
      group("gC", "contact", "Contato", [{ id: "a" }]),
      group("gD", "deal", "Negócio", [{ id: "b" }]),
    ];
    const outDeal = resolveCustomFieldGroups(sections, cf, "deal");
    expect(outDeal.map((r) => r.group?.id ?? null)).toEqual(["gD", null]);
    expect(outDeal[0].fields.map((f) => f.id)).toEqual(["b"]);
    expect(outDeal[1].fields.map((f) => f.id)).toEqual(["a"]);

    const outContact = resolveCustomFieldGroups(sections, cf, "contact");
    expect(outContact.map((r) => r.group?.id ?? null)).toEqual(["gC", null]);
    expect(outContact[0].fields.map((f) => f.id)).toEqual(["a"]);
  });

  it("respeita field.hidden dentro do grupo (usuário ocultou aquele campo)", () => {
    const cf = [F("a", "A"), F("b", "B")];
    const sections = [
      group("g1", "deal", "Docs", [
        { id: "a", hidden: true },
        { id: "b" },
      ]),
    ];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    expect(out).toHaveLength(1);
    expect(out[0].fields.map((f) => f.id)).toEqual(["b"]);
  });

  it("respeita section.hidden (grupo escondido some por inteiro; campos viram órfãos)", () => {
    const cf = [F("a", "A"), F("b", "B")];
    const sections = [
      group("g1", "deal", "Docs", [{ id: "a" }], { hidden: true }),
      group("g2", "deal", "Outros", [{ id: "b" }]),
    ];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    expect(out.map((r) => r.group?.id ?? null)).toEqual(["g2", null]);
    expect(out[1].fields.map((f) => f.id)).toEqual(["a"]);
  });

  it("propaga collapsedDefault do layout para o resultado", () => {
    const cf = [F("a", "A")];
    const sections = [
      group("g1", "deal", "Docs", [{ id: "a" }], { collapsedDefault: true }),
    ];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    expect(out[0].group?.collapsedDefault).toBe(true);
  });

  it("ignora seções normais (sem kind) mesmo se contiverem IDs iguais", () => {
    const cf = [F("a", "A")];
    const sections: SectionConfig[] = [
      { id: "principal", label: "Principal", fields: [{ id: "a", label: "A" }] },
    ];
    const out = resolveCustomFieldGroups(sections, cf, "deal");
    // Sem grupos configurados → fallback flat (CA-01).
    expect(out).toHaveLength(1);
    expect(out[0].group).toBeNull();
    expect(out[0].fields.map((f) => f.id)).toEqual(["a"]);
  });
});
