// Regression: a fabricated cline-pass/* id in the cline registry routes to
// api.cline.bot and 404s upstream ("model not found") because Cline's OAuth
// catalog serves no cline-pass/* models. cline-pass/* ids belong exclusively
// to the clinepass registry (API-key auth; see registry/clinepass.js, #2333).
import { describe, it, expect } from "vitest";
import cline from "../../open-sse/providers/registry/cline.js";
import clinepass from "../../open-sse/providers/registry/clinepass.js";

describe("cline registry namespace integrity", () => {
  it("cline registry lists no cline-pass/* ids (clinepass-only namespace)", () => {
    const offenders = cline.models.filter((m) => m.id.startsWith("cline-pass/"));
    expect(offenders.map((m) => m.id)).toEqual([]);
  });

  it("clinepass registry lists only cline-pass/* ids", () => {
    const offenders = clinepass.models.filter((m) => !m.id.startsWith("cline-pass/"));
    expect(offenders.map((m) => m.id)).toEqual([]);
  });
});
