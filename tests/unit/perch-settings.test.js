// tests/unit/perch-settings.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("child_process", () => ({ exec: (...args) => execMock(...args) }));
vi.mock("@/lib/db", () => ({ getApiKeys: vi.fn(async () => [{ key: "sk-db-key", isActive: true }]) }));

import { GET, POST, DELETE } from "../../src/app/api/cli-tools/perch-settings/route.js";
import { getApiKeys } from "@/lib/db";

const jsonRequest = (body) => ({ json: async () => body });
const localRecord = (cfg) => cfg.records.find((r) => r.scope === "local" && r.providerId === "local");
const readCfg = (home) => fs.readFile(path.join(home, ".perch", "byo-local.json"), "utf8").then((text) => JSON.parse(text));

let home;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "9r-perch-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("PERCH_HOME", "");
  execMock.mockImplementation((cmd, opts, cb) => cb(new Error("not found")));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

describe("Perch settings route", () => {
  it("reports not installed when the binary and the config file are absent", async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({ installed: false, config: null });
  });

  it("reports installed when the binary is on PATH without creating the config", async () => {
    execMock.mockImplementation((cmd, opts, cb) => cb(null, "/usr/local/bin/perch\n"));
    expect((await (await GET()).json()).installed).toBe(true);
    await expect(fs.access(path.join(home, ".perch", "byo-local.json"))).rejects.toThrow();
  });

  it("writes one local BYOLM record and normalizes the base URL", async () => {
    const res = await POST(jsonRequest({ baseUrl: "http://gw.test:20128/", apiKey: "sk-key-abcd", model: "cc/main" }));
    expect(res.status).toBe(200);
    const cfg = await readCfg(home);
    expect(cfg.version).toBe(1);
    expect(localRecord(cfg)).toMatchObject({
      userId: "local-device",
      providerId: "local",
      scope: "local",
      apiKeyCiphertext: "sk-key-abcd",
      baseUrl: "http://gw.test:20128/v1",
      modelId: "cc/main",
      models: [{ id: "cc/main" }],
      keyHint: "…abcd",
      capabilityProfile: null,
      _managedBy: "9router",
    });
    if (process.platform !== "win32") {
      expect((await fs.stat(path.join(home, ".perch", "byo-local.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it("resolves the placeholder key from the dashboard and keeps other records", async () => {
    await fs.mkdir(path.join(home, ".perch"), { recursive: true });
    await fs.writeFile(path.join(home, ".perch", "byo-local.json"), JSON.stringify({
      version: 1,
      records: [
        { providerId: "custom", scope: "cloud", apiKeyCiphertext: "cloud-key" },
        { scope: "local", providerId: "local", baseUrl: "http://old/v1", modelId: "old", createdAt: "2020-01-01T00:00:00.000Z" },
      ],
    }));
    await POST(jsonRequest({ baseUrl: "http://gw.test", apiKey: "sk_9router", model: "new/model" }));
    const cfg = await readCfg(home);
    expect(cfg.records).toHaveLength(2);
    expect(cfg.records[0]).toMatchObject({ providerId: "custom", apiKeyCiphertext: "cloud-key" });
    expect(localRecord(cfg)).toMatchObject({
      apiKeyCiphertext: "sk-db-key",
      createdAt: "2020-01-01T00:00:00.000Z",
      baseUrl: "http://gw.test/v1",
    });

    // GET exposes the local record only, and never a plaintext key.
    const body = await (await GET()).json();
    expect(body.config.records).toHaveLength(1);
    expect(body.config.records[0]).toMatchObject({ scope: "local", baseUrl: "http://gw.test/v1" });
    expect(body.config.records[0].apiKeyCiphertext).toBeUndefined();
  });

  it("rejects a missing model and writes nothing", async () => {
    const res = await POST(jsonRequest({ baseUrl: "http://gw.test", apiKey: "sk-key-abcd", model: "" }));
    expect(res.status).toBe(400);
    await expect(fs.access(path.join(home, ".perch", "byo-local.json"))).rejects.toThrow();
  });

  it("writes a null key and key hint when no key resolves", async () => {
    getApiKeys.mockResolvedValueOnce([]);
    const res = await POST(jsonRequest({ baseUrl: "http://gw.test", model: "cc/main" }));
    expect(res.status).toBe(200);
    expect(localRecord(await readCfg(home))).toMatchObject({
      apiKeyCiphertext: null,
      keyHint: null,
    });
  });

  it("honors PERCH_HOME over the default ~/.perch", async () => {
    const alt = await fs.mkdtemp(path.join(os.tmpdir(), "9r-perch-alt-"));
    vi.stubEnv("PERCH_HOME", alt);
    try {
      const res = await POST(jsonRequest({ baseUrl: "http://gw.test", apiKey: "sk-key-abcd", model: "cc/main" }));
      expect(res.status).toBe(200);
      const cfg = JSON.parse(await fs.readFile(path.join(alt, "byo-local.json"), "utf8"));
      expect(localRecord(cfg)).toMatchObject({ baseUrl: "http://gw.test/v1", modelId: "cc/main" });
      await expect(fs.access(path.join(home, ".perch", "byo-local.json"))).rejects.toThrow();
    } finally {
      await fs.rm(alt, { recursive: true, force: true });
    }
  });

  it("reports 9Router ownership for a Perch-written record by matching the request origin", async () => {
    await fs.mkdir(path.join(home, ".perch"), { recursive: true });
    await fs.writeFile(path.join(home, ".perch", "byo-local.json"), JSON.stringify({
      version: 1,
      records: [{ scope: "local", providerId: "local", baseUrl: "http://gw.test:20128/v1", modelId: "m" }],
    }));
    const req = { headers: new Headers({ host: "gw.test:20128" }) };
    const body = await (await GET(req)).json();
    expect(body.has9Router).toBe(true);
  });

  it("removes only the local record and leaves the file in place", async () => {
    await fs.mkdir(path.join(home, ".perch"), { recursive: true });
    await fs.writeFile(path.join(home, ".perch", "byo-local.json"), JSON.stringify({
      version: 1,
      records: [
        { providerId: "custom", scope: "cloud", apiKeyCiphertext: "cloud-key" },
        { scope: "local", providerId: "local", baseUrl: "http://gw.test/v1", modelId: "m" },
      ],
    }));
    expect((await DELETE()).status).toBe(200);
    expect(await readCfg(home)).toEqual({
      version: 1,
      records: [{ providerId: "custom", scope: "cloud", apiKeyCiphertext: "cloud-key" }],
    });
  });

  it("treats DELETE on a missing file as a no-op", async () => {
    expect((await DELETE()).status).toBe(200);
    await expect(fs.access(path.join(home, ".perch", "byo-local.json"))).rejects.toThrow();
  });

  it("does not clobber an unparseable file", async () => {
    await fs.mkdir(path.join(home, ".perch"), { recursive: true });
    const file = path.join(home, ".perch", "byo-local.json");
    await fs.writeFile(file, "{ not json");
    const res = await POST(jsonRequest({ baseUrl: "http://gw.test", model: "m" }));
    expect(res.status).toBe(500);
    expect(await fs.readFile(file, "utf8")).toBe("{ not json");
  });
});
