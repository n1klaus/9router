// The Perch manual-config snippet is what a user copy-pastes into
// ~/.perch/byo-local.json. It must never carry the dashboard's sk_9router
// placeholder as a credential, and it must produce exactly one /v1 suffix.
import { describe, expect, it } from "vitest";
import {
  buildPerchManualConfig,
  buildPerchRecord,
  perchBaseUrl,
  perchKey,
} from "../../src/app/(dashboard)/dashboard/cli-tools/components/perchManualConfig.js";

const parse = (cfg) => JSON.parse(cfg[0].content);

describe("Perch manual config", () => {
  it("writes the file Perch reads, with one local record", () => {
    const cfg = buildPerchManualConfig({ baseUrl: "http://localhost:20128/v1", apiKey: "sk-real-key", model: "cc/main" });
    expect(cfg).toHaveLength(1);
    expect(cfg[0].filename).toBe("~/.perch/byo-local.json");
    expect(parse(cfg)).toMatchObject({
      version: 1,
      records: [
        {
          userId: "local-device",
          providerId: "local",
          scope: "local",
          apiKeyCiphertext: "sk-real-key",
          baseUrl: "http://localhost:20128/v1",
          modelId: "cc/main",
          models: [{ id: "cc/main" }],
          keyHint: "…-key",
          capabilityProfile: null,
          _managedBy: "9router",
        },
      ],
    });
  });

  it("never writes the sk_9router placeholder", () => {
    const cfg = buildPerchManualConfig({ baseUrl: "http://localhost:20128", apiKey: "sk_9router", model: "cc/main" });
    expect(cfg[0].content).not.toContain("sk_9router");
    expect(parse(cfg).records[0]).toMatchObject({ apiKeyCiphertext: null, keyHint: null });
  });

  it("treats an empty key the same as the placeholder", () => {
    const cfg = buildPerchManualConfig({ baseUrl: "http://localhost:20128", apiKey: "", model: "cc/main" });
    expect(parse(cfg).records[0]).toMatchObject({ apiKeyCiphertext: null, keyHint: null });
  });

  it("produces exactly one /v1 suffix", () => {
    for (const input of ["http://h:20128", "http://h:20128/", "http://h:20128/v1", "http://h:20128/v1/", "http://h:20128/v1//"]) {
      expect(perchBaseUrl(input), input).toBe("http://h:20128/v1");
    }
  });

  it("keeps the placeholder guard in the pure helpers", () => {
    expect(perchKey("sk_9router")).toBe("");
    expect(perchKey("sk-live")).toBe("sk-live");
    expect(perchKey(undefined)).toBe("");
    expect(buildPerchRecord({ baseUrl: "http://h", apiKey: "sk_9router", model: "m" }).apiKeyCiphertext).toBeNull();
  });
});
