// Scenario: a proxy must not send more cache_control blocks than the upstream
// accepts, and must not lose conversation turns that use single-object content.
import { describe, it, expect } from "vitest";
import { anchorClaudeCache, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const CC = { type: "ephemeral" };
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });
const tool = (name) => ({ name, description: "d", input_schema: {} });

// counts markers incl. single-object content — mirrors the upstream contract
function countMarkers(body) {
  let n = 0;
  if (Array.isArray(body.system)) for (const b of body.system) if (b?.cache_control) n++;
  if (Array.isArray(body.tools)) for (const t of body.tools) if (t?.cache_control) n++;
  if (Array.isArray(body.messages)) for (const m of body.messages) {
    if (Array.isArray(m?.content)) {
      for (const b of m.content) if (b?.cache_control) n++;
    } else if (m?.content && typeof m.content === "object" && m.content.cache_control) n++;
  }
  return n;
}

describe("cache marker budget and single-block content", () => {
  it("never emits more than four markers when the client already sent four on single-object content", () => {
    const out = anchorClaudeCache({
      system: [text("s1"), text("s2", { cache_control: CC })],
      tools: [tool("t1"), tool("t2", { cache_control: CC })],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: text("a1", { cache_control: CC }) },
        { role: "user", content: [text("q")] },
      ],
    });
    expect(countMarkers(out)).toBeLessThanOrEqual(4);   // base: 5
  });

  it("wraps a single-object assistant turn's content and anchors it", () => {
    const out = anchorClaudeCache({
      messages: [
        { role: "user", content: [text("u1")] },
        { role: "assistant", content: text("a1") },     // single object, no marker
        { role: "user", content: [text("q")] },
      ],
    });
    const assistant = out.messages.find(m => m.role === "assistant");
    expect(Array.isArray(assistant.content)).toBe(true); // base: still bare object
    expect(countMarkers(out)).toBe(1);                   // base: 0
  });

  it("keeps a turn whose content is a single object and strips its marker", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1")],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    const kept = out.messages.filter(m => JSON.stringify(m.content).includes("u1"));
    expect(kept.length).toBe(1);                        // base: 0 (dropped)
    expect(kept[0].content).toHaveLength(1);           // normalized to array
    expect(kept[0].content[0].cache_control).toBeUndefined();
  });

  it("drops no conversation turn when content is a single text object", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: text("u1") },
        { role: "assistant", content: text("a1") },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(out.messages.length).toBe(3);               // base: 1
    expect(Array.isArray(out.messages[0].content)).toBe(true);
  });

  it("re-anchors the last assistant turn even when it uses single-object content", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: [text("u1")] },
        { role: "assistant", content: text("a1") },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBe(1);                 // base: 0
  });
});
