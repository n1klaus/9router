import { describe, it, expect } from "vitest";
import {
  DEFAULT_UNHEALTHY_STATUSES,
  UNHEALTHY_THRESHOLD_MIN,
  UNHEALTHY_THRESHOLD_MAX,
  UNHEALTHY_RESET_MS_MIN,
  UNHEALTHY_RESET_MS_MAX,
  parseStatusesInput,
} from "../../src/shared/utils/unhealthyStatuses.js";
import {
  parseStatusesCsv,
  DEFAULT_UNHEALTHY_STATUSES as CLI_DEFAULT_UNHEALTHY_STATUSES,
  UNHEALTHY_THRESHOLD_MIN as CLI_UNHEALTHY_THRESHOLD_MIN,
  UNHEALTHY_THRESHOLD_MAX as CLI_UNHEALTHY_THRESHOLD_MAX,
  UNHEALTHY_RESET_MS_MIN as CLI_UNHEALTHY_RESET_MS_MIN,
  UNHEALTHY_RESET_MS_MAX as CLI_UNHEALTHY_RESET_MS_MAX,
} from "../../cli/src/cli/utils/unhealthyStatuses.js";

// The CLI twin (CommonJS) duplicates these values because it cannot import the
// ESM shared module. This suite is the keep-in-sync enforcement: any drift in
// either the constants or the parser fails here.

describe("CLI unhealthyStatuses twin parity", () => {
  it("exports every shared constant with an identical value", () => {
    expect(CLI_DEFAULT_UNHEALTHY_STATUSES).toEqual(DEFAULT_UNHEALTHY_STATUSES);
    expect(CLI_UNHEALTHY_THRESHOLD_MIN).toBe(UNHEALTHY_THRESHOLD_MIN);
    expect(CLI_UNHEALTHY_THRESHOLD_MAX).toBe(UNHEALTHY_THRESHOLD_MAX);
    expect(CLI_UNHEALTHY_RESET_MS_MIN).toBe(UNHEALTHY_RESET_MS_MIN);
    expect(CLI_UNHEALTHY_RESET_MS_MAX).toBe(UNHEALTHY_RESET_MS_MAX);
  });

  it("matches the known server defaults", () => {
    // Anchors so both sides drifting to the same wrong value still fails.
    expect(DEFAULT_UNHEALTHY_STATUSES).toEqual([400, 401, 403, 404, 408, 429, 500, 502, 503, 504]);
    expect(UNHEALTHY_THRESHOLD_MIN).toBe(1);
    expect(UNHEALTHY_THRESHOLD_MAX).toBe(20);
    expect(UNHEALTHY_RESET_MS_MIN).toBe(60000);
    expect(UNHEALTHY_RESET_MS_MAX).toBe(86400000);
  });

  it("parses valid inputs identically", () => {
    const valid = [
      "all",
      "ALL",
      "404",
      "404,500",
      "404, 429",
      "404;429 500",
      " 404 , 500 ",
      "4xx",
      "5xx",
      "4XX",
      "4xx,5xx,404",
      "5xx, 404 ,4xx,404",
      "400",
      "599",
      "400,499,500,599",
      "429 503",
    ];
    for (const input of valid) {
      expect(parseStatusesCsv(input), `CLI result for ${JSON.stringify(input)}`)
        .toEqual(parseStatusesInput(input));
    }
    // Concrete expectations so an agreed-upon wrong answer still fails.
    expect(parseStatusesInput("404, 429")).toEqual([404, 429]);
    expect(parseStatusesInput("all")).toEqual([]);
    expect(parseStatusesInput("5xx, 404 ,4xx,404")).toEqual(["4xx", "5xx", 404]);
    expect(parseStatusesInput("404;429 500")).toEqual([404, 429, 500]);
    expect(parseStatusesInput("4XX")).toEqual(["4xx"]);
  });

  it("rejects invalid inputs identically", () => {
    const invalid = [
      "",
      "   ",
      "99",
      "399",
      "600",
      "abc",
      "40x",
      "404.5",
      "200",
      "404,,500",
      ",404",
      "404,",
      "all, 404",
      "404, abc",
      "404, 600",
      "99, 600",
      "-404",
      "0x404",
      "4e2",
      "4 0 4",
      "404 | 500",
    ];
    for (const input of invalid) {
      expect(parseStatusesCsv(input), `CLI result for ${JSON.stringify(input)}`)
        .toEqual(parseStatusesInput(input));
      expect(parseStatusesInput(input), `shared result for ${JSON.stringify(input)}`).toBe(null);
    }
    expect(parseStatusesInput("")).toBe(null);
    expect(parseStatusesInput("404, 600")).toBe(null);
  });
});
