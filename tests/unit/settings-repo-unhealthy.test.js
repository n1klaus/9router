import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: async () => {
    throw new Error("getAdapter must not be called");
  },
}));

const { mergeWithDefaults } = await import("../../src/lib/db/repos/settingsRepo.js");

describe("mergeWithDefaults unhealthy-skip coercion", () => {
  it("fills missing keys with the shared defaults", () => {
    const merged = mergeWithDefaults({});
    expect(merged.comboUnhealthyThreshold).toBe(3);
    expect(merged.comboUnhealthyResetMs).toBe(24 * 60 * 60 * 1000);
    expect(merged.comboUnhealthyStatuses).toEqual([401, 402, 403, 404]);
  });

  it("coerces invalid thresholds and reset windows to the defaults", () => {
    expect(mergeWithDefaults({ comboUnhealthyThreshold: 0 }).comboUnhealthyThreshold).toBe(3);
    expect(mergeWithDefaults({ comboUnhealthyThreshold: 25 }).comboUnhealthyThreshold).toBe(3);
    expect(mergeWithDefaults({ comboUnhealthyThreshold: "3" }).comboUnhealthyThreshold).toBe(3);
    expect(mergeWithDefaults({ comboUnhealthyThreshold: null }).comboUnhealthyThreshold).toBe(3);
    expect(mergeWithDefaults({ comboUnhealthyThreshold: 5 }).comboUnhealthyThreshold).toBe(5);
    expect(mergeWithDefaults({ comboUnhealthyResetMs: "x" }).comboUnhealthyResetMs).toBe(86400000);
    expect(mergeWithDefaults({ comboUnhealthyResetMs: 59999 }).comboUnhealthyResetMs).toBe(86400000);
    expect(mergeWithDefaults({ comboUnhealthyResetMs: 60000 }).comboUnhealthyResetMs).toBe(60000);
  });

  it("normalizes valid statuses and defaults invalid ones", () => {
    expect(mergeWithDefaults({ comboUnhealthyStatuses: [] }).comboUnhealthyStatuses).toEqual([]);
    expect(mergeWithDefaults({ comboUnhealthyStatuses: [429, "5xx", 429] }).comboUnhealthyStatuses).toEqual(["5xx", 429]);
    expect(mergeWithDefaults({ comboUnhealthyStatuses: null }).comboUnhealthyStatuses).toEqual([401, 402, 403, 404]);
    expect(mergeWithDefaults({ comboUnhealthyStatuses: [99, 404] }).comboUnhealthyStatuses).toEqual([401, 402, 403, 404]);
    expect(mergeWithDefaults({ comboUnhealthyStatuses: "404" }).comboUnhealthyStatuses).toEqual([401, 402, 403, 404]);
  });
});
