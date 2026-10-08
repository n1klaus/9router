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
});
