import { describe, expect, it } from "vitest";

import { composeDepartmentScope } from "../visibility";

describe("composeDepartmentScope", () => {
  it("sem escopo (null) → não altera o where base", () => {
    const base = { OR: [{ assignedToId: "u1" }] };
    expect(composeDepartmentScope(base, null)).toEqual(base);
  });

  it("escopo vazio → não altera o where base", () => {
    const base = { OR: [{ assignedToId: "u1" }] };
    expect(composeDepartmentScope(base, [])).toEqual(base);
  });

  it("escopo + base vazio → só o filtro de departamento", () => {
    expect(composeDepartmentScope({}, ["d1", "d2"])).toEqual({
      departmentId: { in: ["d1", "d2"] },
    });
  });

  it("escopo + base 'own' → AND (restringe, não afrouxa)", () => {
    const base = { OR: [{ assignedToId: "u1" }, { assignedToId: null }] };
    expect(composeDepartmentScope(base, ["d1"])).toEqual({
      AND: [{ departmentId: { in: ["d1"] } }, base],
    });
  });

  it("escopo isola departamentos distintos", () => {
    const suporte = composeDepartmentScope({}, ["dep-suporte"]);
    const vendas = composeDepartmentScope({}, ["dep-vendas"]);
    expect(suporte).not.toEqual(vendas);
  });
});
