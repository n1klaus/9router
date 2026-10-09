import { describe, it, expect } from "vitest";
import {
  splitStatusClasses,
  matchesStatusClasses,
  toggleStatusClass,
  parseStatusesInput,
  formatStatusList,
  formatStatusCodes,
  resolveUnhealthyCfg,
  normalizeStatusesList,
  isValidThreshold,
  isValidResetMs,
  sanitizeUnhealthyOverrides,
  validateUnhealthySettingsPatch,
  validateComboStrategies,
} from "../../src/shared/utils/unhealthyStatuses.js";
import { parseStatusesCsv } from "../../cli/src/cli/utils/unhealthyStatuses.js";

describe("unhealthyStatuses", () => {
  it("splits markers from codes", () => {
    expect(splitStatusClasses(["4xx", 404, "5xx", 500])).toEqual({
      classes: ["4xx", "5xx"],
      codes: [404, 500],
    });
    expect(splitStatusClasses(undefined)).toEqual({ classes: [], codes: [] });
  });

  it("matches by class or code, empty = all", () => {
    expect(matchesStatusClasses(418, [])).toBe(true);
    expect(matchesStatusClasses(404, ["4xx"])).toBe(true);
    expect(matchesStatusClasses(503, ["4xx"])).toBe(false);
    expect(matchesStatusClasses(503, ["5xx"])).toBe(true);
    expect(matchesStatusClasses(404, [404])).toBe(true);
    expect(matchesStatusClasses(429, [404])).toBe(false);
    expect(matchesStatusClasses(503, ["4xx", 503])).toBe(true);
  });

  it("toggles class markers without touching codes", () => {
    expect(toggleStatusClass([404], "4xx", true)).toEqual([404, "4xx"]);
    expect(toggleStatusClass([404, "4xx"], "4xx", false)).toEqual([404]);
    expect(toggleStatusClass(["4xx"], "4xx", true)).toEqual(["4xx"]);
  });

  it("parses textbox input tri-state", () => {
    expect(parseStatusesInput("")).toBe(null);
    expect(parseStatusesInput("   ")).toBe(null);
    expect(parseStatusesInput("all")).toEqual([]);
    expect(parseStatusesInput("404, 429")).toEqual([404, 429]);
    expect(parseStatusesInput("abc")).toBe(null);
  });

  it("formats lists classes-first", () => {
    expect(formatStatusList(["4xx", 404])).toBe("4xx, 404");
    expect(formatStatusCodes(["4xx", 404])).toBe("404");
    expect(formatStatusCodes(undefined)).toBe("");
  });

  it("matches class boundaries exactly", () => {
    expect(matchesStatusClasses(399, ["4xx"])).toBe(false);
    expect(matchesStatusClasses(400, ["4xx"])).toBe(true);
    expect(matchesStatusClasses(499, ["4xx"])).toBe(true);
    expect(matchesStatusClasses(500, ["4xx"])).toBe(false);
    expect(matchesStatusClasses(500, ["5xx"])).toBe(true);
    expect(matchesStatusClasses(599, ["5xx"])).toBe(true);
    expect(matchesStatusClasses(600, ["5xx"])).toBe(false);
  });

  it("matches string statuses and mixed marker/code lists", () => {
    expect(matchesStatusClasses("404", [404])).toBe(true);
    expect(matchesStatusClasses(404, ["4xx", 503])).toBe(true);
    expect(matchesStatusClasses(503, ["4xx", 503])).toBe(true);
    expect(matchesStatusClasses(429, ["5xx", 503])).toBe(false);
  });

  it("rejects the whole input when any token is invalid", () => {
    expect(parseStatusesInput("404, 600")).toBe(null);
    expect(parseStatusesInput("99, 600")).toBe(null);
    expect(parseStatusesInput("200")).toBe(null);
    expect(parseStatusesInput("404.5")).toBe(null);
    expect(parseStatusesInput("all, 404")).toBe(null);
    expect(parseStatusesInput("404, abc")).toBe(null);
    expect(parseStatusesInput("ALL")).toEqual([]);
  });

  it("accepts markers, other separators, dedupe, canonical order", () => {
    expect(parseStatusesInput("404;429 500")).toEqual([404, 429, 500]);
    expect(parseStatusesInput("5xx, 404 ,4xx,404")).toEqual(["4xx", "5xx", 404]);
    expect(parseStatusesInput("4XX")).toEqual(["4xx"]);
    expect(parseStatusesInput("all")).toEqual([]);
  });

  it("resolves per-combo overrides over globals, explicit [] included", () => {
    const globals = { comboUnhealthyThreshold: 3, comboUnhealthyResetMs: 86400000, comboUnhealthyStatuses: [404] };
    expect(resolveUnhealthyCfg({}, globals)).toEqual({ threshold: 3, resetMs: 86400000, statuses: [404] });
    expect(resolveUnhealthyCfg({ unhealthyThreshold: 5, unhealthyStatuses: ["4xx"] }, globals))
      .toEqual({ threshold: 5, resetMs: 86400000, statuses: ["4xx"] });
    expect(resolveUnhealthyCfg({ unhealthyStatuses: [] }, globals).statuses).toEqual([]);
  });

  it("normalizes stored lists or rejects them", () => {
    expect(normalizeStatusesList([])).toEqual([]);
    expect(normalizeStatusesList(["4xx", 429, 429])).toEqual(["4xx", 429]);
    expect(normalizeStatusesList([404, "5xx", "4xx", 403])).toEqual(["4xx", "5xx", 403, 404]);
    expect(normalizeStatusesList([99, 404])).toBe(null);
    expect(normalizeStatusesList([null])).toBe(null);
    expect(normalizeStatusesList([400.5])).toBe(null);
    expect(normalizeStatusesList("404")).toBe(null);
    expect(normalizeStatusesList(undefined)).toBe(null);
  });

  it("validates threshold and reset bounds", () => {
    expect(isValidThreshold(1)).toBe(true);
    expect(isValidThreshold(20)).toBe(true);
    expect(isValidThreshold(0)).toBe(false);
    expect(isValidThreshold(21)).toBe(false);
    expect(isValidThreshold(1.5)).toBe(false);
    expect(isValidThreshold("3")).toBe(false);
    expect(isValidResetMs(60000)).toBe(true);
    expect(isValidResetMs(86400000)).toBe(true);
    expect(isValidResetMs(59999)).toBe(false);
    expect(isValidResetMs(86400001)).toBe(false);
    expect(isValidResetMs(90000.5)).toBe(false);
  });

  it("validates a settings patch", () => {
    expect(validateUnhealthySettingsPatch({})).toBe(null);
    expect(validateUnhealthySettingsPatch({ comboUnhealthyThreshold: 3, comboUnhealthyResetMs: 60000, comboUnhealthyStatuses: [] })).toBe(null);
    expect(validateUnhealthySettingsPatch({ comboUnhealthyThreshold: 0 })).toMatch(/comboUnhealthyThreshold/);
    expect(validateUnhealthySettingsPatch({ comboUnhealthyResetMs: 30000 })).toMatch(/comboUnhealthyResetMs/);
    expect(validateUnhealthySettingsPatch({ comboUnhealthyStatuses: "404" })).toMatch(/comboUnhealthyStatuses/);
    expect(validateUnhealthySettingsPatch({ comboUnhealthyStatuses: [200] })).toMatch(/comboUnhealthyStatuses/);
  });

  it("validates per-combo overrides and sanitizes bad fields", () => {
    expect(validateComboStrategies(undefined)).toBe(null);
    expect(validateComboStrategies({ c1: { unhealthyThreshold: 5, unhealthyStatuses: ["4xx", 404] } })).toBe(null);
    expect(validateComboStrategies({ c1: { unhealthyStatuses: [999] } })).toMatch(/c1/);
    expect(validateComboStrategies({ c1: { unhealthyThreshold: 99 } })).toMatch(/c1/);
    expect(validateComboStrategies({ c1: "nope" })).toMatch(/c1/);
    const source = { fallbackStrategy: "fusion", unhealthyThreshold: 99, unhealthyStatuses: [404, 404], junk: 1 };
    const cleaned = sanitizeUnhealthyOverrides(source);
    expect(cleaned).toEqual({ fallbackStrategy: "fusion", unhealthyStatuses: [404], junk: 1 });
    expect(source.unhealthyThreshold).toBe(99); // source object preserved
  });

  it("keeps CLI and shared status parsers identical across corpus", () => {
    const corpus = [
      "", "404", "404,500", "4xx", "4xx,5xx,404", "all", " 404 , 500 ",
      "99", "abc", "404,,500", "40x",
    ];
    for (const input of corpus) {
      expect(parseStatusesCsv(input), `CLI result for ${JSON.stringify(input)}`).toEqual(parseStatusesInput(input));
    }
  });
});
