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
    expect(merged.comboUnhealthySkipEnabled).toBe(true);
  });

  it("keeps explicit false and coerces garbage to enabled", () => {
    expect(mergeWithDefaults({ comboUnhealthySkipEnabled: false }).comboUnhealthySkipEnabled).toBe(false);
    expect(mergeWithDefaults({ comboUnhealthySkipEnabled: null }).comboUnhealthySkipEnabled).toBe(true);
    expect(mergeWithDefaults({ comboUnhealthySkipEnabled: 0 }).comboUnhealthySkipEnabled).toBe(true);
    expect(mergeWithDefaults({ comboUnhealthySkipEnabled: "false" }).comboUnhealthySkipEnabled).toBe(true);
  });

  it("sanitizes dirty per-combo overrides on read", () => {
    const merged = mergeWithDefaults({
      comboStrategies: {
        c1: { fallbackStrategy: "fusion", unhealthyThreshold: 99, unhealthyResetMs: 30000, unhealthyStatuses: ["4XX", 429], junk: 1 },
        c2: { unhealthyStatuses: [999] },
        c3: "legacy-junk",
      },
    });
    expect(merged.comboStrategies.c1).toEqual({ fallbackStrategy: "fusion", unhealthyStatuses: ["4xx", 429], junk: 1 });
    expect(merged.comboStrategies.c2).toEqual({});
    expect(merged.comboStrategies.c3).toBe("legacy-junk");
    // Default map is rebuilt, not shared or mutated.
    expect(mergeWithDefaults({}).comboStrategies).toEqual({});
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

  it("never mutates DEFAULT_SETTINGS through shared nested references", async () => {
    const { DEFAULT_UNHEALTHY_STATUSES } = await import("@/shared/utils/unhealthyStatuses.js");
    // Statuses: merge hands out a copy...
    mergeWithDefaults({}).comboUnhealthyStatuses.push(500);
    // ...and the shared default list stays untouched.
    expect(DEFAULT_UNHEALTHY_STATUSES).toEqual([401, 402, 403, 404]);

    // capacityAdapter: the per-entry models rewrite must not leak into the
    // constant used to seed the next merge.
    const first = mergeWithDefaults({});
    first.capacityAdapter.vision.models.push("oc/mimo-v2.6-flash-free");
    const second = mergeWithDefaults({});
    expect(second.capacityAdapter.vision.models).toEqual([]);
    expect(second.capacityAdapter.vision.enabled).toBe(true);
  });

  it("rewrites legacy capacityAdapter model names without corrupting the default", async () => {
    const merged = mergeWithDefaults({
      capacityAdapter: { vision: { enabled: true, roundRobin: false, models: ["oc/mimo-v2.5-free"] } },
    });
    expect(merged.capacityAdapter.vision.models).toEqual(["oc/mimo-v2.6-flash-free"]);
  });
});
