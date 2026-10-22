import { describe, it, expect, vi } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";

vi.mock("@/models", () => ({
  getModelAliases: vi.fn(async () => ({})),
  setModelAlias: vi.fn(),
  getCustomModels: vi.fn(async () => []),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

import {
  getProviderThinkingContext,
  applyWireAwareThinkingFormat,
} from "@/shared/constants/providers.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { GET } from "@/app/api/v1/models/route.js";

describe("provider thinking surface", () => {
  describe("getProviderThinkingContext", () => {
    it("returns { wire: 'openai', format: null } for kilo-gateway", () => {
      expect(getProviderThinkingContext("kilo-gateway")).toEqual({
        wire: "openai",
        format: null,
      });
    });

    it("returns { wire: 'openai', format: null } for cline", () => {
      expect(getProviderThinkingContext("cline")).toEqual({
        wire: "openai",
        format: null,
      });
    });

    it("returns { wire: 'claude', format: null } for minimax", () => {
      expect(getProviderThinkingContext("minimax")).toEqual({
        wire: "claude",
        format: null,
      });
    });

    it("resolves alias kgw to { wire: 'openai', format: null }", () => {
      expect(getProviderThinkingContext("kgw")).toEqual({
        wire: "openai",
        format: null,
      });
    });

    it("surfaces declared format for openrouter as { wire: 'openai', format: 'openai' }", () => {
      expect(getProviderThinkingContext("openrouter")).toEqual({
        wire: "openai",
        format: "openai",
      });
    });

    it("returns null for does-not-exist", () => {
      expect(getProviderThinkingContext("does-not-exist")).toBeNull();
    });

    it("failure probe: unknown provider and alias with no registry entry return null without throwing", () => {
      expect(() => getProviderThinkingContext("unknown-xyz-provider")).not.toThrow();
      expect(getProviderThinkingContext("unknown-xyz-provider")).toBeNull();

      expect(() => getProviderThinkingContext("non-existent-alias")).not.toThrow();
      expect(getProviderThinkingContext("non-existent-alias")).toBeNull();
    });
  });

  describe("applyWireAwareThinkingFormat", () => {
    it("replaces thinkingFormat with openai for kilo-gateway while preserving vision and reasoning", () => {
      const caps = { vision: true, reasoning: true, thinkingFormat: "minimax" };
      const result = applyWireAwareThinkingFormat(caps, "kilo-gateway");
      expect(result).toEqual({
        vision: true,
        reasoning: true,
        thinkingFormat: "openai",
      });
    });

    it("replaces thinkingFormat with openai for cline", () => {
      const caps = { thinkingFormat: "minimax" };
      const result = applyWireAwareThinkingFormat(caps, "cline");
      expect(result.thinkingFormat).toBe("openai");
    });

    it("keeps thinkingFormat minimax for minimax (Anthropic-shaped provider untouched)", () => {
      const caps = { thinkingFormat: "minimax" };
      const result = applyWireAwareThinkingFormat(caps, "minimax");
      expect(result.thinkingFormat).toBe("minimax");
    });
  });

  describe("GET /v1/models wire-aware capabilities", () => {
    it("reports capabilities.thinkingFormat === 'openai' for kimchi/minimax-m3", async () => {
      const res = await GET();
      const body = await res.json();
      const kimchiM3 = body.data?.find((m) => m.id === "kimchi/minimax-m3");
      expect(kimchiM3).toBeDefined();
      expect(kimchiM3.capabilities.thinkingFormat).toBe("openai");
    });
  });

  describe("dashboard thinking level resolution", () => {
    it("returns null for a thinking level the provider does not offer", () => {
      const providerId = "kimchi";
      const modelId = "minimax-m3";
      const thinkingCtx = getProviderThinkingContext(providerId);
      const levels = getThinkingLevels(providerId, modelId, thinkingCtx?.wire, thinkingCtx?.format);

      const resolveThinkingSuffix = (mode) => {
        if (!mode || mode === "auto") return null;
        return levels && levels.includes(mode) ? mode : null;
      };

      expect(resolveThinkingSuffix("ultra")).toBeNull();
      expect(resolveThinkingSuffix("not-a-level")).toBeNull();
    });
  });

  describe("source assertions", () => {
    const repoRoot = resolve(__dirname, "../..");

    it("grep -c 'getThinkingLevels(providerId, modelId,' in the dashboard page equals 2", () => {
      const dashboardPath = "src/app/(dashboard)/dashboard/providers/[id]/page.js";
      const count = execSync(`grep -c 'getThinkingLevels(providerId, modelId,' "${resolve(repoRoot, dashboardPath)}"`, {
        encoding: "utf8",
      }).trim();
      expect(Number(count)).toBe(2);
    });

    it("grep -rln 'open-sse/providers/index.js' src/app src/shared must not grow", () => {
      const matches = execSync(
        `git grep -l 'open-sse/providers/index\\.js' -- src/app src/shared || true`,
        { cwd: repoRoot, encoding: "utf8" }
      ).trim();
      expect(matches).toBe("");
    });
  });
});
