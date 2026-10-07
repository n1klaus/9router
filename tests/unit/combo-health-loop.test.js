import { describe, it, expect, beforeEach } from "vitest";
import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";
import { recordComboFailure, resetComboHealth } from "../../open-sse/services/comboHealth.js";

const CFG = { threshold: 3, resetMs: 86400000, statuses: [] };
const noopLog = { info() {}, warn() {}, debug() {}, error() {} };
// Real Response objects, mirroring tests/unit/commandcode-executor.test.js.
const dead = () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404, headers: { "Content-Type": "application/json" } });
const live = () => new Response(JSON.stringify({ id: "chatcmpl-test", choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });

async function run(models, cfg = CFG) {
  const calls = [];
  const res = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models,
    handleSingleModel: async (b, m) => { calls.push(m); return m === "p/dead" ? dead() : live(); },
    log: noopLog,
    comboName: "C",
    comboStrategy: "fallback",
    healthCfg: cfg,
  });
  return { calls, res };
}

describe("handleComboChat unhealthy skip", () => {
  beforeEach(() => { resetComboHealth(); resetComboRotation(); });

  it("skips a model with a pre-seeded failure streak", async () => {
    for (let i = 0; i < 3; i++) recordComboFailure("C", "p/dead", 404, CFG);
    const { calls, res } = await run(["p/dead", "p/live"]);
    expect(calls).toEqual(["p/live"]);
    expect(res.ok).toBe(true);
    expect((await res.json()).choices[0].message.content).toBe("ok");
  });

  it("records failures while falling through, then skips", async () => {
    const cfg = { threshold: 2, resetMs: 86400000, statuses: [] };
    expect((await run(["p/dead", "p/live"], cfg)).calls).toEqual(["p/dead", "p/live"]); // failure 1
    expect((await run(["p/dead", "p/live"], cfg)).calls).toEqual(["p/dead", "p/live"]); // failure 2 → skipped
    expect((await run(["p/dead", "p/live"], cfg)).calls).toEqual(["p/live"]);
  });

  it("tries all models anyway when every model is skipped", async () => {
    for (let i = 0; i < 3; i++) {
      recordComboFailure("C", "p/dead", 404, CFG);
      recordComboFailure("C", "p/live", 404, CFG);
    }
    const { calls, res } = await run(["p/dead", "p/live"]);
    expect(calls).toEqual(["p/dead", "p/live"]);
    expect(res.ok).toBe(true);
  });

  it("is inert when healthCfg is omitted", async () => {
    for (let i = 0; i < 5; i++) recordComboFailure("C", "p/dead", 404, CFG);
    const calls = [];
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/dead", "p/live"],
      handleSingleModel: async (b, m) => { calls.push(m); return m === "p/dead" ? dead() : live(); },
      log: noopLog,
      comboName: "C",
      comboStrategy: "fallback",
    });
    expect(calls).toEqual(["p/dead", "p/live"]);
    expect(res.ok).toBe(true);
  });
});
