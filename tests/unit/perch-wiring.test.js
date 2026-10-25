// tests/unit/perch-wiring.test.js
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

describe("Perch dashboard wiring", () => {
  it("registers the settings getter in the batch status route", () => {
    const src = read("../../src/app/api/cli-tools/all-statuses/route.js");
    expect(src).toContain('import { GET as perchGet } from "../perch-settings/route";');
    expect(src).toMatch(/perch:\s*perchGet/);
  });

  it("routes the perch page to the generic card", () => {
    const src = read("../../src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js");
    const start = src.indexOf('case "pi":');
    const group = src.slice(start, src.indexOf("default:", start));
    expect(group).toContain('case "perch":');
  });

  it("teaches the generic card the Perch install command and file", () => {
    const src = read("../../src/app/(dashboard)/dashboard/cli-tools/components/GenericCliToolCard.js");
    expect(src).toContain("npm install -g perchai-cli");
    expect(src).toContain("~/.perch/byo-local.json");
  });
});
