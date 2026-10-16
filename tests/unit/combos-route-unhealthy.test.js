import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getComboById: vi.fn(),
  updateCombo: vi.fn(),
  deleteCombo: vi.fn(),
  getComboByName: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboHealth: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getComboById: mocks.getComboById,
  updateCombo: mocks.updateCombo,
  deleteCombo: mocks.deleteCombo,
  getComboByName: mocks.getComboByName,
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
}));

vi.mock("open-sse/services/comboHealth.js", () => ({
  resetComboHealth: mocks.resetComboHealth,
}));

const { PUT, DELETE } = await import("../../src/app/api/combos/[id]/route.js");

const putRequest = (body) => ({ json: async () => body });
const putParams = (id) => ({ params: Promise.resolve({ id }) });

describe("PUT/DELETE /api/combos/[id] unhealthy-skip behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComboById.mockResolvedValue({ id: "c1", name: "alpha" });
    mocks.updateCombo.mockResolvedValue({ id: "c1", name: "alpha" });
    mocks.deleteCombo.mockResolvedValue(true);
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getSettings.mockResolvedValue({});
    mocks.updateSettings.mockImplementation(async (updates) => updates);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carries a sanitized strategy override across rename instead of 400ing on dirty legacy data", async () => {
    mocks.getComboById.mockResolvedValue({ id: "c1", name: "old-name" });
    mocks.updateCombo.mockResolvedValue({ id: "c1", name: "new-name" });
    mocks.getSettings.mockResolvedValue({
      comboStrategies: {
        "old-name": {
          unhealthyStatuses: [999],
          unhealthyThreshold: 99,
          unhealthyResetMs: 60000,
          fallbackStrategy: "fusion",
        },
      },
    });

    const res = await PUT(putRequest({ name: "new-name" }), putParams("c1"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "c1", name: "new-name" });
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    const written = mocks.updateSettings.mock.calls[0][0];
    expect(written.comboStrategies).toEqual({
      "new-name": { unhealthyResetMs: 60000, fallbackStrategy: "fusion" },
    });
    expect(written.comboStrategies).not.toHaveProperty("old-name");
  });

  it("merges on rename collision: target keys win, carried keys fill the gaps", async () => {
    mocks.getComboById.mockResolvedValue({ id: "c1", name: "old-name" });
    mocks.updateCombo.mockResolvedValue({ id: "c1", name: "new-name" });
    mocks.getSettings.mockResolvedValue({
      comboStrategies: {
        "old-name": { unhealthyThreshold: 5, fallbackStrategy: "fusion" },
        "new-name": { unhealthyThreshold: 8 },
      },
    });

    const res = await PUT(putRequest({ name: "new-name" }), putParams("c1"));

    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    const written = mocks.updateSettings.mock.calls[0][0];
    expect(written.comboStrategies).toEqual({
      "new-name": { unhealthyThreshold: 8, fallbackStrategy: "fusion" },
    });
    expect(written.comboStrategies).not.toHaveProperty("old-name");
  });

  it("still returns 200 with the combo when updateSettings throws during the carry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getComboById.mockResolvedValue({ id: "c1", name: "old-name" });
    mocks.updateCombo.mockResolvedValue({ id: "c1", name: "new-name" });
    mocks.getSettings.mockResolvedValue({
      comboStrategies: { "old-name": { unhealthyThreshold: 5 } },
    });
    mocks.updateSettings.mockRejectedValue(new Error("disk full"));

    const res = await PUT(putRequest({ name: "new-name" }), putParams("c1"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "c1", name: "new-name" });
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("without a rename, resets health for the name and never touches settings", async () => {
    const res = await PUT(putRequest({ models: ["cc/claude-opus-4-6"] }), putParams("c1"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "c1", name: "alpha" });
    expect(mocks.resetComboHealth).toHaveBeenCalledTimes(1);
    expect(mocks.resetComboHealth).toHaveBeenCalledWith("alpha");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("returns 404 when the combo id is unknown", async () => {
    mocks.updateCombo.mockResolvedValue(null);

    const res = await PUT(putRequest({ name: "renamed" }), putParams("missing"));

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.resetComboHealth).not.toHaveBeenCalled();
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("rejects invalid name characters with 400 and performs no writes or resets", async () => {
    const res = await PUT(putRequest({ name: "bad name!" }), putParams("c1"));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/letters, numbers/);
    expect(mocks.updateCombo).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.resetComboHealth).not.toHaveBeenCalled();
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("rejects a duplicate name with 400 and performs no writes or resets", async () => {
    mocks.getComboByName.mockResolvedValue({ id: "c2", name: "taken" });

    const res = await PUT(putRequest({ name: "taken" }), putParams("c1"));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/);
    expect(mocks.updateCombo).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.resetComboHealth).not.toHaveBeenCalled();
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("DELETE removes the combo and resets health for its name", async () => {
    const res = await DELETE({}, putParams("c1"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mocks.resetComboHealth).toHaveBeenCalledTimes(1);
    expect(mocks.resetComboHealth).toHaveBeenCalledWith("alpha");
    expect(mocks.resetComboRotation).toHaveBeenCalledWith("alpha");
  });

  it("DELETE returns 404 for an unknown combo without resetting health", async () => {
    mocks.deleteCombo.mockResolvedValue(false);

    const res = await DELETE({}, putParams("missing"));

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(mocks.resetComboHealth).not.toHaveBeenCalled();
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });
});
