import { NextResponse } from "next/server";
import { resolveCliApiKey } from "../resolveApiKey.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const getPerchDir = () => process.env.PERCH_HOME?.trim() || path.join(os.homedir(), ".perch");
const getPerchConfigPath = () => path.join(getPerchDir(), "byo-local.json");

// Presence: the binary on PATH, else a config the user already has.
const checkPerchInstalled = async () => {
  const isWindows = os.platform() === "win32";
  try {
    await execAsync(isWindows ? "where perch" : "which perch", { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getPerchConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Only for writes: ENOENT starts a fresh file, anything else is left untouched.
const readConfigForWrite = async () => {
  try {
    return JSON.parse(await fs.readFile(getPerchConfigPath(), "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return { version: 1, records: [] };
    throw err;
  }
};

const findLocalRecord = (config) =>
  (config?.records || []).find((r) => r.scope === "local" && r.providerId === "local") || null;

// Dashboard origin, preferring proxy headers. Headers.get joins repeats with commas.
const requestOrigin = (request) => {
  const first = (value) => value?.split(",")[0]?.trim();
  const host = first(request?.headers?.get?.("x-forwarded-host")) || request?.headers?.get?.("host");
  if (!host) return null;
  const proto = first(request?.headers?.get?.("x-forwarded-proto")) || "http";
  return `${proto}://${host}`;
};

const sameOrigin = (url, origin) => {
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

// Perch drops unknown fields on its next `byolm set`, so ownership cannot rely
// on `_managedBy` alone: a record we did not write still counts when it points
// back at the dashboard origin.
const has9RouterConfig = (config, origin) => {
  const record = findLocalRecord(config);
  if (!record) return false;
  return record._managedBy === "9router" || sameOrigin(record.baseUrl, origin);
};

const normalizeBaseUrl = (raw) => {
  const trimmed = String(raw).trim().replace(/\/+$/, "");
  const normalized = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid protocol");
  }
  return normalized;
};

export async function GET(request) {
  try {
    const installed = await checkPerchInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "Perch CLI is not installed" });
    }
    let config = null;
    try {
      config = JSON.parse(await fs.readFile(getPerchConfigPath(), "utf-8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err; // GET never creates the file
    }
    const local = findLocalRecord(config);
    // byo-local.json can also hold cloud/byok keys that are not 9Router's to
    // expose: the card only needs the local record's baseUrl/modelId.
    return NextResponse.json({
      installed: true,
      config: config
        ? { ...config, records: local ? [{ ...local, apiKeyCiphertext: undefined }] : [] }
        : null,
      has9Router: has9RouterConfig(config, requestOrigin(request)),
      configPath: getPerchConfigPath(),
    });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const { baseUrl, apiKey, model } = body || {};
  if (!baseUrl) {
    return NextResponse.json({ error: { message: "baseUrl is required" } }, { status: 400 });
  }

  let normalizedBaseUrl;
  try {
    normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  } catch {
    return NextResponse.json({ error: { message: "baseUrl must be a valid http(s) URL" } }, { status: 400 });
  }

  try {
    const configPath = getPerchConfigPath();
    const existing = await readConfigForWrite();
    const previous = findLocalRecord(existing);
    const modelId = String(model || "").trim() || previous?.modelId;
    if (!modelId) {
      return NextResponse.json({ error: { message: "model is required" } }, { status: 400 });
    }

    const key = await resolveCliApiKey(apiKey);
    const now = new Date().toISOString();
    const record = {
      userId: "local-device",
      providerId: "local",
      scope: "local",
      apiKeyCiphertext: key || null,
      baseUrl: normalizedBaseUrl,
      modelId,
      models: [{ id: modelId }],
      keyHint: key ? `…${key.slice(-4)}` : null,
      capabilityProfile: null,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      _managedBy: "9router",
    };
    const records = (Array.isArray(existing.records) ? existing.records : []).filter(
      (r) => !(r.scope === "local" && r.providerId === "local")
    );
    records.push(record);

    await fs.mkdir(getPerchDir(), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ ...existing, version: 1, records }, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    await fs.chmod(configPath, 0o600); // mode only applies when creating
    return NextResponse.json({ success: true, message: "Perch settings applied successfully!", configPath });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getPerchConfigPath();
    // Read directly: readConfigForWrite would create the file it then deletes.
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(configPath, "utf-8"));
    } catch (err) {
      if (err.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw err;
    }
    const records = (Array.isArray(existing.records) ? existing.records : []).filter(
      (r) => !(r.scope === "local" && r.providerId === "local")
    );
    await fs.writeFile(configPath, JSON.stringify({ ...existing, version: 1, records }, null, 2), "utf-8");
    await fs.chmod(configPath, 0o600);
    return NextResponse.json({ success: true, message: "Perch 9Router settings removed" });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
