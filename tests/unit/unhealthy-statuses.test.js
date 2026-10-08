import { describe, it, expect } from "vitest";
import {
  splitStatusClasses,
  matchesStatusClasses,
  toggleStatusClass,
  parseStatusesInput,
  formatStatusList,
  formatStatusCodes,
  resolveUnhealthyCfg,
} from "../../src/shared/utils/unhealthyStatuses.js";

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

  it("drops out-of-range codes when parsing", () => {
    expect(parseStatusesInput("404, 600")).toEqual([404]);
    expect(parseStatusesInput("99, 600")).toBe(null);
    expect(parseStatusesInput("ALL")).toEqual([]);
  });

  it("resolves per-combo overrides over globals, explicit [] included", () => {
    const globals = { comboUnhealthyThreshold: 3, comboUnhealthyResetMs: 86400000, comboUnhealthyStatuses: [404] };
    expect(resolveUnhealthyCfg({}, globals)).toEqual({ threshold: 3, resetMs: 86400000, statuses: [404] });
    expect(resolveUnhealthyCfg({ unhealthyThreshold: 5, unhealthyStatuses: ["4xx"] }, globals))
      .toEqual({ threshold: 5, resetMs: 86400000, statuses: ["4xx"] });
    expect(resolveUnhealthyCfg({ unhealthyStatuses: [] }, globals).statuses).toEqual([]);
  });
});
