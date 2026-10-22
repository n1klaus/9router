import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordComboFailure,
  recordComboSuccess,
  getSkippedModels,
  resetComboHealth,
  shouldCount,
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

  it("defaults the reset window to 24 hours", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      recordComboFailure("C", "p/m1", 404, { threshold: 1, statuses: [] });
      expect(getSkippedModels("C", ["p/m1"], {})).toEqual(["p/m1"]);
      vi.advanceTimersByTime(600001);
      expect(getSkippedModels("C", ["p/m1"], {})).toEqual(["p/m1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts whole classes via 4xx/5xx markers", () => {
    const cfg = { threshold: 1, resetMs: 600000, statuses: ["4xx"] };
    recordComboFailure("C", "p/4", 418, cfg);
    recordComboFailure("C", "p/5", 503, cfg);
    expect(getSkippedModels("C", ["p/4", "p/5"], cfg)).toEqual(["p/4"]);
    const both = { threshold: 1, resetMs: 600000, statuses: ["4xx", "5xx"] };
    recordComboFailure("C", "p/4", 418, both);
    recordComboFailure("C", "p/5", 503, both);
    expect(getSkippedModels("C", ["p/4", "p/5"], both)).toEqual(["p/4", "p/5"]);
  });

  it("keeps a streak when every gap falls inside the window", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cfg = { threshold: 3, resetMs: 600000, statuses: [] };
      recordComboFailure("C", "p/m1", 404, cfg);
      vi.advanceTimersByTime(cfg.resetMs - 1);
      recordComboFailure("C", "p/m1", 404, cfg);
      vi.advanceTimersByTime(cfg.resetMs - 1);
      recordComboFailure("C", "p/m1", 404, cfg);
      expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual(["p/m1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never extends a skip window: it expires one window after the crossing", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cfg = { threshold: 1, resetMs: 600000, statuses: [] };
      recordComboFailure("C", "p/m1", 404, cfg); // crossing: skip until t0 + window
      vi.advanceTimersByTime(cfg.resetMs / 2);
      recordComboFailure("C", "p/m1", 404, cfg); // must not push the window out
      vi.advanceTimersByTime(cfg.resetMs / 2 + 1);
      expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reclaims entries for models that left the passed list", () => {
    const cfg = { threshold: 2, resetMs: 600000, statuses: [] };
    recordComboFailure("C", "p/old", 404, cfg);
    expect(getSkippedModels("C", ["p/new"], cfg)).toEqual([]);
    recordComboFailure("C", "p/old", 404, cfg);
    // The first failure was reclaimed, so this is a fresh streak of 1.
    expect(getSkippedModels("C", ["p/old"], cfg)).toEqual([]);
  });

  it("always counts an attempt that threw (null status)", () => {
    const cfg = { threshold: 1, resetMs: 600000, statuses: [404] };
    recordComboFailure("C", "p/boom", null, cfg);
    expect(getSkippedModels("C", ["p/boom"], cfg)).toEqual(["p/boom"]);
  });

  it("defaults count configured client and transient server errors", () => {
    recordComboFailure("C", "p/503", 503, { threshold: 1 });
    expect(getSkippedModels("C", ["p/503"], { threshold: 1 })).toEqual(["p/503"]);
    recordComboFailure("C", "p/404", 404, { threshold: 1 });
    expect(getSkippedModels("C", ["p/404"], { threshold: 1 })).toEqual(["p/404"]);
    recordComboFailure("C", "p/any", 503, { threshold: 1, statuses: [] });
    expect(getSkippedModels("C", ["p/any"], { threshold: 1, statuses: [] })).toEqual(["p/any"]);
  });

  it("falls back to default statuses when a configured list is corrupt", () => {
    const cfg = { threshold: 1, statuses: [99] };
    expect(shouldCount(500, cfg)).toBe(true);
    recordComboFailure("C", "p/500", 500, cfg);
    expect(getSkippedModels("C", ["p/500"], cfg)).toEqual(["p/500"]);
    recordComboFailure("C", "p/404", 404, cfg);
    expect(getSkippedModels("C", ["p/404"], cfg)).toEqual(["p/404"]);
  });

  it("keeps explicit empty statuses counting every fallbackable error", () => {
    const cfg = { threshold: 1, statuses: [] };
    recordComboFailure("C", "p/500", 500, cfg);
    expect(getSkippedModels("C", ["p/500"], cfg)).toEqual(["p/500"]);
  });

  it("counts a status covered by a class and code only once", () => {
    const cfg = { threshold: 2, statuses: ["4xx", 404] };
    recordComboFailure("C", "p/m1", 404, cfg);
    expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
    recordComboFailure("C", "p/m1", 404, cfg);
    expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual(["p/m1"]);
  });

  it("defaults omitted threshold and reset window", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cfg = { statuses: [] };
      recordComboFailure("C", "p/m1", 404, cfg);
      recordComboFailure("C", "p/m1", 404, cfg);
      expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
      recordComboFailure("C", "p/m1", 404, cfg);
      expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual(["p/m1"]);
      vi.advanceTimersByTime(600001);
      expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual(["p/m1"]);
      vi.advanceTimersByTime(86400000);
      expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("success clears a skipped model", () => {
    const cfg = { threshold: 2, statuses: [] };
    recordComboFailure("C", "p/m1", 404, cfg);
    recordComboFailure("C", "p/m1", 404, cfg);
    expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual(["p/m1"]);
    recordComboSuccess("C", "p/m1");
    expect(getSkippedModels("C", ["p/m1"], cfg)).toEqual([]);
  });
});
