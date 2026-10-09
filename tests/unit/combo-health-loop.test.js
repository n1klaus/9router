import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleComboChat, handleFusionChat, resetComboRotation } from "../../open-sse/services/combo.js";
import { recordComboFailure, resetComboHealth } from "../../open-sse/services/comboHealth.js";

const CFG = { threshold: 3, resetMs: 86400000, statuses: [] };
const noopLog = { info() {}, warn() {}, debug() {}, error() {} };
// Real Response objects, mirroring tests/unit/commandcode-executor.test.js.
const dead = () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404, headers: { "Content-Type": "application/json" } });
const live = () => new Response(JSON.stringify({ id: "chatcmpl-test", choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
const overloaded = () => new Response(JSON.stringify({ error: { message: "service overloaded" } }), { status: 503, headers: { "Content-Type": "application/json" } });
const badRequest = () => new Response(JSON.stringify({ error: { message: "invalid request" } }), { status: 400, headers: { "Content-Type": "application/json" } });

async function runStatus(models, cfg, statusFor) {
  const calls = [];
  const res = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models,
    handleSingleModel: async (b, m) => { calls.push(m); return statusFor(m); },
    log: noopLog,
    comboName: "C",
    comboStrategy: "fallback",
    healthCfg: cfg,
  });
  return { calls, res };
}

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

  it("never counts non-fallbackable errors", async () => {
    const cfg = { threshold: 1, resetMs: 86400000, statuses: [] };
    const statusFor = (m) => (m === "p/bad" ? badRequest() : live());
    const first = await runStatus(["p/bad", "p/live"], cfg, statusFor);
    expect(first.calls).toEqual(["p/bad"]); // 400 returns immediately, no fallback
    expect(first.res.status).toBe(400);
    const second = await runStatus(["p/bad", "p/live"], cfg, statusFor);
    expect(second.calls).toEqual(["p/bad"]); // still attempted: 400 was never counted
  });

  it("counts a transient 503 toward the skip threshold", async () => {
    const cfg = { threshold: 1, resetMs: 86400000, statuses: [] };
    const statusFor = (m) => (m === "p/503" ? overloaded() : live());
    const first = await runStatus(["p/503", "p/live"], cfg, statusFor);
    expect(first.calls).toEqual(["p/503", "p/live"]);
    const second = await runStatus(["p/503", "p/live"], cfg, statusFor);
    expect(second.calls).toEqual(["p/live"]); // 503 counted once → skipped (threshold 1)
    expect(second.res.ok).toBe(true);
  });

  it("waits out the transient cooldown before falling through", async () => {
    vi.useFakeTimers();
    try {
      const calls = [];
      const promise = handleComboChat({
        body: { messages: [{ role: "user", content: "hi" }] },
        models: ["p/over", "p/live"],
        handleSingleModel: async (b, m) => { calls.push(m); return m === "p/over" ? overloaded() : live(); },
        log: noopLog,
        comboName: "C",
        comboStrategy: "fallback",
        healthCfg: { threshold: 1, resetMs: 86400000, statuses: [] },
      });
      let settled = false;
      const tracked = promise.then((res) => { settled = true; return res; }, (err) => { settled = true; throw err; });
      // Bounded pump: "overloaded" hits the backoff text rule → 2000 ms cooldown sleep.
      for (let i = 0; i < 50 && !settled; i++) await vi.advanceTimersByTimeAsync(500);
      const res = await tracked;
      expect(calls).toEqual(["p/over", "p/live"]);
      expect(res.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts an attempt that throws, even when the statuses list is restricted", async () => {
    const cfg = { threshold: 1, resetMs: 86400000, statuses: [404] };
    const calls = [];
    const fail = async () => handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/boom", "p/live"],
      handleSingleModel: async (b, m) => { calls.push(m); if (m === "p/boom") throw new Error("socket hang up"); return live(); },
      log: noopLog,
      comboName: "C",
      comboStrategy: "fallback",
      healthCfg: cfg,
    });
    await fail();
    expect(calls).toEqual(["p/boom", "p/live"]);
    calls.length = 0;
    const res = await fail();
    expect(calls).toEqual(["p/live"]); // the throwing model is skipped on the next request
    expect(res.ok).toBe(true);
  });

  it("never counts a status outside the configured list", async () => {
    const cfg = { threshold: 1, resetMs: 86400000, statuses: [404] };
    const statusFor = (m) => (m === "p/503" ? overloaded() : live());
    const first = await runStatus(["p/503", "p/live"], cfg, statusFor);
    expect(first.calls).toEqual(["p/503", "p/live"]);
    const second = await runStatus(["p/503", "p/live"], cfg, statusFor);
    expect(second.calls).toEqual(["p/503", "p/live"]); // 503 is not counted under [404]
  });

  it("queries every fusion panel despite unhealthy streaks", async () => {
    const models = ["p/a", "p/b", "p/c"];
    const cfg = { threshold: 1, resetMs: 86400000, statuses: [404] };
    for (const model of models) recordComboFailure("C", model, 404, cfg);

    const calls = [];
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (body, model, isPanel) => {
        calls.push({ model, isPanel });
        return live();
      },
      log: noopLog,
      comboName: "C",
      comboStrategy: "fusion",
    });

    expect(calls.filter(({ isPanel }) => isPanel).map(({ model }) => model).sort()).toEqual(models.slice().sort());
  });
});
