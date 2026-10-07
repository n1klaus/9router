import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordComboFailure,
  recordComboSuccess,
  getSkippedModels,
  resetComboHealth,
} from "../../open-sse/services/comboHealth.js";

const CFG = { threshold: 3, resetMs: 600000, statuses: [] };

describe("comboHealth", () => {
  beforeEach(() => resetComboHealth());

  it("skips a model after threshold consecutive failures", () => {
    expect(getSkippedModels("C", ["p/m1", "p/m2"], CFG)).toEqual([]);
    recordComboFailure("C", "p/m1", 404, CFG);
    recordComboFailure("C", "p/m1", 404, CFG);
    expect(getSkippedModels("C", ["p/m1", "p/m2"], CFG)).toEqual([]);
    recordComboFailure("C", "p/m1", 404, CFG);
    expect(getSkippedModels("C", ["p/m1", "p/m2"], CFG)).toEqual(["p/m1"]);
  });

  it("re-admits a skipped model after the reset window", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 3; i++) recordComboFailure("C", "p/m1", 404, CFG);
      expect(getSkippedModels("C", ["p/m1"], CFG)).toEqual(["p/m1"]);
      vi.advanceTimersByTime(CFG.resetMs + 1);
      expect(getSkippedModels("C", ["p/m1"], CFG)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores statuses not in the configured list", () => {
    const cfg = { threshold: 1, resetMs: 600000, statuses: [404] };
    recordComboFailure("C", "p/m1", 429, cfg);
    expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
    recordComboFailure("C", "p/m1", 404, cfg);
    expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual(["p/m1"]);
  });

  it("success clears the failure streak", () => {
    const cfg = { threshold: 2, resetMs: 600000, statuses: [] };
    recordComboFailure("C", "p/m1", 404, cfg);
    recordComboSuccess("C", "p/m1");
    recordComboFailure("C", "p/m1", 404, cfg);
    expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
  });

  it("decays a stale streak so old failures do not count toward the threshold", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cfg = { threshold: 2, resetMs: 600000, statuses: [] };
      recordComboFailure("C", "p/m1", 404, cfg); // streak starts
      vi.advanceTimersByTime(cfg.resetMs + 1);
      recordComboFailure("C", "p/m1", 404, cfg); // window passed → streak restarts at 1
      expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
