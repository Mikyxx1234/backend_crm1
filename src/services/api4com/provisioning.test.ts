/**
 * Testes do ProvisioningService — Fase 2.
 *
 * Estratégia: mock do Prisma + mock do Api4ComClient (via DI indireta
 * mockando o módulo client). Cada cenário verifica a sequência de
 * estados persistidos e o resultado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sipExtension: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    callProviderConfig: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/crypto/secrets", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
}));

vi.mock("@/services/call-provider-configs", () => ({
  getOrCreateApi4ComProviderConfig: vi.fn(),
  resolveApi4ComServiceToken: vi.fn(),
  resolveOrgApi4ComGateway: vi.fn(),
}));

const mockClient = {
  findUsers: vi.fn(),
  createUser: vi.fn(),
  createNextExtension: vi.fn(),
  upsertIntegration: vi.fn(),
  deleteExtension: vi.fn(),
  deleteUser: vi.fn(),
};
vi.mock("./client", () => ({
  getApi4ComClient: () => mockClient,
  Api4ComClient: vi.fn(function MockApi4ComClient() {
    return mockClient;
  }),
  resetApi4ComClient: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  getOrCreateApi4ComProviderConfig,
  resolveApi4ComServiceToken,
  resolveOrgApi4ComGateway,
} from "@/services/call-provider-configs";
import { Api4ComConflictError } from "./errors";

const getOrCreateConfig = vi.mocked(getOrCreateApi4ComProviderConfig);
const resolveToken = vi.mocked(resolveApi4ComServiceToken);
const resolveGateway = vi.mocked(resolveOrgApi4ComGateway);

const prismaMock = prisma as unknown as {
  sipExtension: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
  callProviderConfig: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

import { enableTelephony, disableTelephony, getProvisioningStatus } from "./provisioning";

function makeExt(overrides: Record<string, unknown> = {}) {
  return {
    id: "ext-1",
    organizationId: "org-1",
    userId: "user-1",
    label: "Api4com (auto)",
    sipUri: "",
    authUser: "",
    authPasswordEncrypted: "",
    wsServer: "",
    stunServers: [],
    turnServer: null,
    providerMeta: null,
    status: "ACTIVE",
    telephonyEnabled: false,
    api4comUserId: null,
    api4comGateway: null,
    provisioningStep: "IDLE",
    provisioningError: null,
    provisionedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ProvisioningService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API4COM_GATEWAY = "test-gateway";
    process.env.API4COM_WEBHOOK_VERSION = "1.8";
    process.env.NEXT_PUBLIC_APP_URL = "https://crm.test";

    prismaMock.sipExtension.update.mockImplementation(({ data }) => {
      return Promise.resolve(makeExt(data));
    });
    getOrCreateConfig.mockResolvedValue({
      webhookUrl: "/api/webhooks/calls/api4com?token=wh-tok-123",
    } as Awaited<ReturnType<typeof getOrCreateApi4ComProviderConfig>>);
    resolveToken.mockResolvedValue("tok-test");
    resolveGateway.mockResolvedValue("test-gateway");
  });

  it("provisiona novo usuário end-to-end", async () => {
    prismaMock.sipExtension.findUnique.mockResolvedValue(null);
    prismaMock.sipExtension.create.mockResolvedValue(makeExt());
    prismaMock.user.findUnique.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
      phone: "48999998888",
    });

    mockClient.findUsers.mockResolvedValue([]);
    mockClient.createUser.mockResolvedValue({ id: "api4-user-1" });
    mockClient.createNextExtension.mockResolvedValue({
      id: "ext-remote-1",
      ramal: "1001",
      senha: "sip-secret",
      domain: "pbx.api4com.com",
      bina: "1199999999",
    });
    mockClient.upsertIntegration.mockResolvedValue(undefined);

    const result = await enableTelephony("user-1", "org-1");

    expect(result.success).toBe(true);
    expect(result.step).toBe("ACTIVE");
    expect(mockClient.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "test@example.com",
        phone: "48999998888",
      }),
    );
    expect(mockClient.createNextExtension).toHaveBeenCalledWith({
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
    });
    expect(mockClient.upsertIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: "test-gateway",
        metadata: expect.objectContaining({
          webhookUrl: "https://crm.test/api/webhooks/calls/api4com?token=wh-tok-123",
          webhookVersion: "1.8",
        }),
      }),
    );
  });

  it("trata 409 (usuário já existe) e pula para CREATE_EXTENSION", async () => {
    prismaMock.sipExtension.findUnique.mockResolvedValue(null);
    prismaMock.sipExtension.create.mockResolvedValue(makeExt());
    prismaMock.user.findUnique.mockResolvedValue({ email: "dup@test.com" });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      email: "dup@test.com",
      name: "Dup User",
      phone: null,
    });

    mockClient.findUsers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "existing-remote-user" }]);
    mockClient.createUser.mockRejectedValue(
      new Api4ComConflictError("already exists", { status: 409, endpoint: "/users" }),
    );
    mockClient.createNextExtension.mockResolvedValue({
      id: "ext-2",
      ramal: "1002",
      senha: "sip-pw",
      domain: "test.pbx",
    });
    mockClient.upsertIntegration.mockResolvedValue(undefined);

    const result = await enableTelephony("user-1", "org-1");

    expect(result.success).toBe(true);
    expect(mockClient.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "4833328530" }),
    );
    expect(mockClient.createNextExtension).toHaveBeenCalledOnce();
  });

  it("falha não-recuperável marca FAILED com erro", async () => {
    prismaMock.sipExtension.findUnique.mockResolvedValue(null);
    prismaMock.sipExtension.create.mockResolvedValue(makeExt());
    prismaMock.user.findUnique.mockResolvedValue({ email: "test@ex.com" });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      email: "test@ex.com",
      name: "Fail User",
      phone: null,
    });

    mockClient.findUsers.mockResolvedValue([]);
    mockClient.createUser.mockRejectedValue(new Error("Network exploded"));

    const result = await enableTelephony("user-1", "org-1");

    expect(result.success).toBe(false);
    expect(result.step).toBe("FAILED");
    expect(result.error).toContain("Network exploded");
  });

  it("retoma FAILED com ramal já persistido sem recriar extensão", async () => {
    const existing = makeExt({
      provisioningStep: "FAILED",
      authUser: "1079",
      authPasswordEncrypted: "enc:kept",
      sipUri: "1079@cruzeiroead.api4com.com",
      api4comUserId: "api4-user-1",
      providerMeta: { extensionId: "ext-1079", ramal: "1079" },
    });
    prismaMock.sipExtension.findUnique.mockResolvedValue(existing);
    prismaMock.sipExtension.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...existing, ...data }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      email: "teste@eduit.com.br",
      name: "Pinha Dev",
    });
    mockClient.findUsers.mockResolvedValue([{ id: "api4-user-1" }]);
    mockClient.upsertIntegration.mockRejectedValue(new Error("422 webhook"));

    const result = await enableTelephony("user-1", "org-1");

    expect(result.success).toBe(true);
    expect(result.step).toBe("ACTIVE");
    expect(mockClient.createUser).not.toHaveBeenCalled();
    expect(mockClient.createNextExtension).not.toHaveBeenCalled();
  });

  it("retorno noop se já está ACTIVE", async () => {
    prismaMock.sipExtension.findUnique.mockResolvedValue(
      makeExt({ provisioningStep: "ACTIVE" }),
    );

    const result = await enableTelephony("user-1", "org-1");

    expect(result.success).toBe(true);
    expect(result.step).toBe("ACTIVE");
    expect(mockClient.createUser).not.toHaveBeenCalled();
  });

  it("disableTelephony apaga ramal e usuário remotos e limpa credenciais", async () => {
    prismaMock.sipExtension.findUnique.mockResolvedValue(
      makeExt({
        provisioningStep: "ACTIVE",
        telephonyEnabled: true,
        api4comUserId: "api4-user-1",
        providerMeta: { extensionId: "ext-remote-1", ramal: "1001" },
      }),
    );
    mockClient.deleteExtension.mockResolvedValue(undefined);
    mockClient.deleteUser.mockResolvedValue({ deleted: true });

    const result = await disableTelephony("user-1", "org-1");

    expect(result.success).toBe(true);
    expect(result.step).toBe("DISABLED");
    expect(mockClient.deleteExtension).toHaveBeenCalledWith("ext-remote-1");
    expect(mockClient.deleteUser).toHaveBeenCalledWith("api4-user-1");
    expect(prismaMock.sipExtension.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          telephonyEnabled: false,
          status: "INACTIVE",
          provisioningStep: "DISABLED",
          api4comUserId: null,
          sipUri: "",
          authUser: "",
        }),
      }),
    );
  });

  it("disableTelephony marca FAILED se o DELETE remoto falhar", async () => {
    prismaMock.sipExtension.findUnique.mockResolvedValue(
      makeExt({
        provisioningStep: "ACTIVE",
        telephonyEnabled: true,
        api4comUserId: "api4-user-1",
        providerMeta: { extensionId: "ext-remote-1" },
      }),
    );
    mockClient.deleteExtension.mockRejectedValue(new Error("API4Comm down"));

    const result = await disableTelephony("user-1", "org-1");

    expect(result.success).toBe(false);
    expect(result.step).toBe("FAILED");
    expect(result.error).toContain("API4Comm down");
    expect(prismaMock.sipExtension.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provisioningStep: "FAILED",
          provisioningError: expect.stringContaining("API4Comm down"),
        }),
      }),
    );
  });

  it("getProvisioningStatus retorna null se nenhum registro", async () => {
    prismaMock.sipExtension.findUnique.mockResolvedValue(null);
    const status = await getProvisioningStatus("user-1", "org-1");
    expect(status).toBeNull();
  });
});
