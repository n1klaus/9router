// tests/unit/perch-wiring.test.js
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

// The aggregate handler imports one getter per tool. Stub them all so the test
// drives the real route without touching the filesystem or child_process.
// (vi.mock is hoisted, so these paths must be literal — no shared const.)
const { calls, makeStub } = vi.hoisted(() => {
  const calls = [];
  const makeStub = (id) => ({
    GET: (request) => {
      calls.push({ id, request });
      return { json: async () => ({ installed: true, id }) };
    },
  });
  return { calls, makeStub };
});

vi.mock("../../src/app/api/cli-tools/claude-settings/route", () => makeStub("claude"));
vi.mock("../../src/app/api/cli-tools/codex-settings/route", () => makeStub("codex"));
vi.mock("../../src/app/api/cli-tools/opencode-settings/route", () => makeStub("opencode"));
vi.mock("../../src/app/api/cli-tools/droid-settings/route", () => makeStub("droid"));
vi.mock("../../src/app/api/cli-tools/openclaw-settings/route", () => makeStub("openclaw"));
vi.mock("../../src/app/api/cli-tools/hermes-settings/route", () => makeStub("hermes"));
vi.mock("../../src/app/api/cli-tools/cowork-settings/route", () => makeStub("cowork"));
vi.mock("../../src/app/api/cli-tools/cline-settings/route", () => makeStub("cline"));
vi.mock("../../src/app/api/cli-tools/kilo-settings/route", () => makeStub("kilo"));
vi.mock("../../src/app/api/cli-tools/deepseek-tui-settings/route", () => makeStub("deepseek-tui"));
vi.mock("../../src/app/api/cli-tools/jcode-settings/route", () => makeStub("jcode"));
vi.mock("../../src/app/api/cli-tools/grok-build-settings/route", () => makeStub("grok-build"));
vi.mock("../../src/app/api/cli-tools/devin-settings/route", () => makeStub("devin"));
vi.mock("../../src/app/api/cli-tools/pi-settings/route", () => makeStub("pi"));
vi.mock("../../src/app/api/cli-tools/omp-settings/route", () => makeStub("omp"));
vi.mock("../../src/app/api/cli-tools/crush-settings/route", () => makeStub("crush"));
vi.mock("../../src/app/api/cli-tools/forge-settings/route", () => makeStub("forge"));
vi.mock("../../src/app/api/cli-tools/smelt-settings/route", () => makeStub("smelt"));
vi.mock("../../src/app/api/cli-tools/codewhale-settings/route", () => makeStub("codewhale"));
vi.mock("../../src/app/api/cli-tools/perch-settings/route", () => makeStub("perch"));

import { GET } from "../../src/app/api/cli-tools/all-statuses/route.js";

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

  it("teaches the generic card the Perch install command and config builder", () => {
    const src = read("../../src/app/(dashboard)/dashboard/cli-tools/components/GenericCliToolCard.js");
    expect(src).toContain("npm install -g perchai-cli");
    // The record shape lives in perchManualConfig.js; the card only wires it.
    expect(src).toContain('case "perch":');
    expect(src).toMatch(/buildPerchManualConfig\(\{ baseUrl: effectiveUrl, apiKey: key, model: mod \}\)/);
  });

  // The perch getter is the only one whose answer depends on the dashboard
  // origin, so the aggregate handler must hand it the request. Without this,
  // a Perch-written record silently reports "Not configured".
  it("forwards the request to every getter, perch included", async () => {
    calls.length = 0;
    const sentinel = { headers: new Headers({ host: "gw.test:20128" }) };

    const body = await (await GET(sentinel)).json();

    expect(calls.length).toBe(20);
    for (const { id, request } of calls) expect(request, id).toBe(sentinel);
    expect(body.perch).toMatchObject({ installed: true, id: "perch" });
  });
});
