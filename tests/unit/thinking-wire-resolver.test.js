import { describe, it, expect } from "vitest";
import {
  resolveThinkingFormat,
  NATIVE_ONLY_FORMATS,
  FORMAT_TO_NATIVE,
  isOpenAIWireFormat,
} from "../../open-sse/translator/concerns/thinking.js";

describe("resolveThinkingFormat", () => {
  it("provider-declared format wins", () => {
    expect(resolveThinkingFormat({ providerFormat: "openai", capsFormat: "minimax", targetFormat: "openai" })).toBe("openai");
  });

  it("model's own format wins on a non-OpenAI wire", () => {
    expect(resolveThinkingFormat({ providerFormat: null, capsFormat: "minimax", targetFormat: "claude" })).toBe("minimax");
  });

  it("model's own native-only format loses to the wire default on an OpenAI wire", () => {
    expect(resolveThinkingFormat({ providerFormat: "claude-adaptive", capsFormat: "minimax", targetFormat: "openai" })).toBe("claude-adaptive");
  });

  it("a model's minimax format is treated as native-only on an OpenAI wire", () => {
    expect(resolveThinkingFormat({ providerFormat: null, capsFormat: "minimax", targetFormat: "openai" })).toBe("openai");
  });

  it("wire default when nothing is declared", () => {
    expect(resolveThinkingFormat({ providerFormat: null, capsFormat: null, targetFormat: "gemini" })).toBe("gemini-budget");
  });
});

describe("shared wire facts", () => {
  it("NATIVE_ONLY_FORMATS contains minimax", () => {
    expect(NATIVE_ONLY_FORMATS.has("minimax")).toBe(true);
  });

  it("isOpenAIWireFormat is true for openai and openai-responses", () => {
    expect(isOpenAIWireFormat("openai")).toBe(true);
    expect(isOpenAIWireFormat("openai-responses")).toBe(true);
    expect(isOpenAIWireFormat("claude")).toBe(false);
  });

  it("FORMAT_TO_NATIVE maps each wire to its native format", () => {
    expect(FORMAT_TO_NATIVE.openai).toBe("openai");
    expect(FORMAT_TO_NATIVE["openai-responses"]).toBe("openai");
    expect(FORMAT_TO_NATIVE.claude).toBe("claude-budget");
    expect(FORMAT_TO_NATIVE.gemini).toBe("gemini-budget");
  });
});
