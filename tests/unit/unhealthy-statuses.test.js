import { describe, it, expect } from "vitest";
import {
  splitStatusClasses,
  matchesStatusClasses,
  toggleStatusClass,
  parseStatusesInput,
  formatStatusList,
  formatStatusCodes,
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
});
