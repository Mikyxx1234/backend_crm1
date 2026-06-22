import { describe, expect, it } from "vitest";

import {
  parseApi4ComExtensionsList,
  pickExtensionForEmail,
} from "@/services/telephony-providers/api4com";

describe("parseApi4ComExtensionsList", () => {
  it("aceita array direto", () => {
    const list = parseApi4ComExtensionsList([
      {
        id: 1,
        domain: "empresa.api4com.com",
        ramal: "1000",
        senha: "secret",
        email_address: "a@b.com",
      },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].ramal).toBe("1000");
  });

  it("aceita wrapper { data: [] }", () => {
    const list = parseApi4ComExtensionsList({
      data: [
        {
          id: 2,
          domain: "empresa.api4com.com",
          extension: "1001",
          password: "pw",
        },
      ],
    });
    expect(list[0].ramal).toBe("1001");
    expect(list[0].senha).toBe("pw");
  });
});

describe("pickExtensionForEmail", () => {
  const extensions = [
    {
      id: 1,
      domain: "d.api4com.com",
      ramal: "1000",
      senha: "x",
      email_address: "financeiro@eduit.com.br",
    },
  ];

  it("casa por email_address", () => {
    const picked = pickExtensionForEmail(extensions, "financeiro@eduit.com.br");
    expect(picked?.ramal).toBe("1000");
  });
});
