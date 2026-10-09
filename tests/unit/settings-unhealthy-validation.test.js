import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboHealth: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
}));

vi.mock("open-sse/services/comboHealth.js", () => ({
  resetComboHealth: mocks.resetComboHealth,
}));

const { PATCH } = await import("../../src/app/api/settings/route.js");

describe("PATCH /api/settings unhealthy-skip validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSettings.mockImplementation(async (updates) => updates);
    mocks.getSettings.mockResolvedValue({});
  });

  it.each([
    [{ comboUnhealthyThreshold: 0 }, /comboUnhealthyThreshold/],
    [{ comboUnhealthyThreshold: 21 }, /comboUnhealthyThreshold/],
    [{ comboUnhealthyThreshold: 1.5 }, /comboUnhealthyThreshold/],
    [{ comboUnhealthyResetMs: 30000 }, /comboUnhealthyResetMs/],
    [{ comboUnhealthyResetMs: 86400001 }, /comboUnhealthyResetMs/],
    [{ comboUnhealthyStatuses: "404" }, /comboUnhealthyStatuses/],
    [{ comboUnhealthyStatuses: [200] }, /comboUnhealthyStatuses/],
    [{ comboUnhealthyStatuses: [404.5] }, /comboUnhealthyStatuses/],
    [{ comboStrategies: { c1: { unhealthyStatuses: [999] } } }, /c1/],
    [{ comboStrategies: { c1: { unhealthyThreshold: 99 } } }, /c1/],
    [{ comboStrategies: { c1: "nope" } }, /c1/],
    [{ comboUnhealthySkipEnabled: 0 }, /comboUnhealthySkipEnabled/],
    [{ comboUnhealthySkipEnabled: "true" }, /comboUnhealthySkipEnabled/],
    [{ comboUnhealthySkipEnabled: null }, /comboUnhealthySkipEnabled/],
  ])("rejects %j with 400 and writes nothing", async (payload, message) => {
    const res = await PATCH({ json: async () => ({ ...payload }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.resetComboHealth).not.toHaveBeenCalled();
  });

  it("canonicalizes a valid statuses list before storing", async () => {
    const res = await PATCH({ json: async () => ({ comboUnhealthyStatuses: [429, "4xx", 429] }) });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ comboUnhealthyStatuses: ["4xx", 429] })
    );
    expect(mocks.resetComboHealth).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes uppercase class markers before storing", async () => {
    const res = await PATCH({ json: async () => ({ comboUnhealthyStatuses: ["4XX", "5XX", 404] }) });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ comboUnhealthyStatuses: ["4xx", "5xx", 404] })
    );
  });

  it("accepts boolean comboUnhealthySkipEnabled values", async () => {
    for (const value of [true, false]) {
      const res = await PATCH({ json: async () => ({ comboUnhealthySkipEnabled: value }) });
      expect(res.status).toBe(200);
      expect(mocks.updateSettings).toHaveBeenCalledWith({ comboUnhealthySkipEnabled: value });
    }
  });

  it("resets combo health when comboUnhealthySkipEnabled toggles off", async () => {
    const res = await PATCH({ json: async () => ({ comboUnhealthySkipEnabled: false }) });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ comboUnhealthySkipEnabled: false });
    expect(mocks.resetComboHealth).toHaveBeenCalledTimes(1);
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("passes valid thresholds and per-combo overrides through", async () => {
    const res = await PATCH({
      json: async () => ({
        comboUnhealthyThreshold: 5,
        comboUnhealthyResetMs: 60000,
        comboStrategies: { c1: { unhealthyThreshold: 5, fallbackStrategy: "fusion" } },
      }),
    });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        comboUnhealthyThreshold: 5,
        comboUnhealthyResetMs: 60000,
        comboStrategies: { c1: { unhealthyThreshold: 5, fallbackStrategy: "fusion" } },
      })
    );
  });

  it("rejects null and array bodies with 400 (no write, no reset)", async () => {
    for (const body of [null, [1, 2]]) {
      const res = await PATCH({ json: async () => body });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/JSON object/);
    }
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.resetComboHealth).not.toHaveBeenCalled();
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("treats comboStrategies: null as unset instead of persisting null", async () => {
    const res = await PATCH({ json: async () => ({ comboStrategies: null }) });
    expect(res.status).toBe(200);
    const written = mocks.updateSettings.mock.calls[0][0];
    expect(written).not.toHaveProperty("comboStrategies");
  });

  it("does not reset combo state for unrelated keys", async () => {
    const res = await PATCH({ json: async () => ({ headroomEnabled: true }) });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ headroomEnabled: true });
    expect(mocks.resetComboHealth).not.toHaveBeenCalled();
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("resets only combo health (not rotation) when only unhealthy keys change", async () => {
    const res = await PATCH({ json: async () => ({ comboUnhealthyThreshold: 5 }) });
    expect(res.status).toBe(200);
    expect(mocks.resetComboHealth).toHaveBeenCalledTimes(1);
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });
});
