/**
 * API POST /api/activities/alerts/[activityId] — userId do body não falsificável.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: vi.fn(),
  runWithApiUserContext: vi.fn(async (_user: unknown, fn: () => unknown) => fn()),
}));

vi.mock("@/services/activity-alerts", () => ({
  applyActivityAlertAction: vi.fn(),
}));

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { applyActivityAlertAction } from "@/services/activity-alerts";
import { POST } from "@/app/api/activities/alerts/[activityId]/route";

const AUTH_USER = {
  id: "auth_user",
  name: "Auth",
  email: "auth@test.com",
  role: "MEMBER",
  organizationId: "org_1",
  isSuperAdmin: false,
};

describe("POST /api/activities/alerts/[activityId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      ok: true,
      user: AUTH_USER,
      viaToken: false,
    });
    vi.mocked(runWithApiUserContext).mockImplementation(async (_u, fn) => fn());
    vi.mocked(applyActivityAlertAction).mockResolvedValue({ ok: true });
  });

  it("rejeita body com userId (não falsificável)", async () => {
    const req = new Request("http://localhost/api/activities/alerts/act_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "dismiss", userId: "victim" }),
    });
    const res = await POST(req, { params: Promise.resolve({ activityId: "act_1" }) });
    expect(res.status).toBe(400);
    expect(applyActivityAlertAction).not.toHaveBeenCalled();
  });

  it("usa exclusivamente userId do auth", async () => {
    const req = new Request("http://localhost/api/activities/alerts/act_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "snooze", kind: "DUE" }),
    });
    const res = await POST(req, { params: Promise.resolve({ activityId: "act_1" }) });
    expect(res.status).toBe(200);
    expect(applyActivityAlertAction).toHaveBeenCalledWith(
      "auth_user",
      "org_1",
      "act_1",
      { action: "snooze", kind: "DUE" },
    );
  });
});
