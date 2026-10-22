import { describe, it, expect } from "vitest";
import {
  applyThinking,
  parseSuffix,
  extractThinking,
} from "../../open-sse/translator/concerns/thinkingUnified.js";
import { fmtThink } from "../../src/sse/utils/logger.js";

describe("MiniMax thinking wire scope", () => {
  it("(1) sends xhigh reasoning effort on openai wire for minimax model on kilo-gateway", () => {
    const body = { reasoning_effort: "xhigh" };
    applyThinking("openai", "minimax/minimax-m3.1-flash:free", body, "kilo-gateway");
    expect(body.reasoning_effort).toBe("xhigh");
    expect(body.thinking).toBeUndefined();
  });

  it("(1b) sends xhigh reasoning effort on openai wire for minimax model on cline gateway", () => {
    const body = { reasoning_effort: "xhigh" };
    applyThinking("openai", "minimax/minimax-m3.1-flash:free", body, "cline");
    expect(body.reasoning_effort).toBe("xhigh");
    expect(body.thinking).toBeUndefined();
  });

  it("(2) sends xhigh reasoning effort on openai wire for MiniMax-M3 on minimax provider", () => {
    const body = { reasoning_effort: "xhigh" };
    applyThinking("openai", "MiniMax-M3", body, "minimax");
    expect(body.reasoning_effort).toBe("xhigh");
  });

  it("(3) sends adaptive switch on claude wire for MiniMax-M3 on minimax provider", () => {
    const body = { reasoning_effort: "high" };
    applyThinking("claude", "MiniMax-M3", body, "minimax");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("(4) leaves no reasoning_effort and no thinking when reasoning_effort is auto on openai wire", () => {
    const body = { reasoning_effort: "auto" };
    applyThinking("openai", "minimax/minimax-m3.1-flash:free", body, "kilo-gateway");
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect("reasoning_effort" in body).toBe(false);
  });

  it("(5) leaves no effort key inside body.reasoning when reasoning_effort is auto on openai-responses wire for muse", () => {
    const body = { reasoning_effort: "auto" };
    applyThinking("openai-responses", "muse-spark-1.3-contributor-free", body, "muse");
    expect(body.reasoning?.effort).toBeUndefined();
  });

  it("(6) preserves reasoning_effort none on openai wire", () => {
    const body = { reasoning_effort: "none" };
    applyThinking("openai", "minimax/minimax-m3.1-flash:free", body, "kilo-gateway");
    expect(body.reasoning_effort).toBe("none");
  });

  it("(7) leaves body.output_config.effort as xhigh on claude wire for minimax-code", () => {
    const body = { reasoning_effort: "xhigh" };
    applyThinking("claude", "MiniMax-M3.1-Flash-Preview", body, "minimax-code");
    expect(body.output_config?.effort).toBe("xhigh");
  });

  it("(8) maps suffix (thinking) to override mode auto", () => {
    expect(parseSuffix("MiniMax-M3(thinking)")).toEqual({
      cleanModel: "MiniMax-M3",
      override: { mode: "auto" },
    });
  });

  it("(9) formats extracted thinking from case 1 as xhigh", () => {
    const body = { reasoning_effort: "xhigh" };
    applyThinking("openai", "minimax/minimax-m3.1-flash:free", body, "kilo-gateway");
    expect(fmtThink(extractThinking(body))).toBe("xhigh");
  });
});
