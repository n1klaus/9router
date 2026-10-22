import { describe, expect, it } from "vitest";

import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("getThinkingLevels — wire-derived effort lists", () => {
  it("MiniMax M3.1 on an OpenAI-shaped wire offers low..xhigh, no minimal", () => {
    expect(
      getThinkingLevels("kilo-gateway", "minimax/minimax-m3.1-flash:free", "openai")
    ).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("MiniMax-M3 on a Claude-shaped wire keeps the on/off list", () => {
    expect(getThinkingLevels("minimax", "MiniMax-M3", "claude")).toEqual([
      "none",
      "thinking",
    ]);
  });

  it("an OpenAI model on an OpenAI-shaped wire offers the OpenAI list", () => {
    expect(
      getThinkingLevels("kilo-gateway", "openai/gpt-5.5", "openai")
    ).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("a Claude model on an OpenAI-shaped wire follows the wire, not the model", () => {
    expect(
      getThinkingLevels("kilo-gateway", "claude-opus-4.7", "openai")
    ).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("the provider-declared format wins and falls back to the base list", () => {
    const levels = getThinkingLevels("tokenrouter", "glm-5.3", "openai", "tokenrouter");
    expect(levels).toContain("low");
    expect(levels).not.toContain("thinking");
  });

  it("the two-argument call for MiniMax Code M3.1 is unchanged", () => {
    expect(
      getThinkingLevels("minimax-code", "MiniMax-M3.1-Flash-Preview")
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("a wire the MiniMax family has no list for falls back to the model's own format", () => {
    expect(() =>
      getThinkingLevels("kilo-gateway", "minimax/minimax-m3.1-flash:free", "gemini")
    ).not.toThrow();
  });
});
