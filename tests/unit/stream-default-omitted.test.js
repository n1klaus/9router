// An omitted `stream` field means non-streaming (OpenAI semantics): the client
// gets plain JSON.
//
// Regression: chatCore defaulted an omitted `stream` to streaming, but the
// same-format (openai -> openai) translation path passes the client body
// through untouched — so the upstream answered plain JSON while 9router framed
// the client response as SSE and appended `data: [DONE]`. A client that omits
// `stream` and JSON.parses the reply (Perch's probe: POST /v1/chat/completions
// without `stream`) then fails on its own response.
//
// The paired defect: when the resolved decision IS streaming but the client
// body says nothing about `stream`, the upstream body must still carry
// `stream: true` — otherwise upstream returns JSON under an SSE-framed
// response (the same split, mirrored).
//
// Drives the REAL handleChatCore; only the executor's HTTP is mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    execute: executeMock,
    refreshCredentials: vi.fn(async () => null),
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: () => null,
  isNativePassthrough: () => false,
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: () => null,
}));

vi.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

// image.js imports Agent from "undici" (not installed in some dev envs); the
// prefetch path is irrelevant to stream-decision assertions.
vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  encodeDataUri: (mimeType, base64) => `data:${mimeType};base64,${base64}`,
  parseDataUri: (url) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(url);
    return m ? { mimeType: m[1], base64: m[2] } : null;
  },
  fetchImageAsBase64: async () => null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { getProviderModels } = await import("../../open-sse/config/providerModels.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");

// Non-forced provider: resolved `stream` follows the client. Forced provider:
// resolved `stream` is true whatever the client said.
const NON_FORCED_PROVIDER = "kimi";
const FORCED_PROVIDER = "openai";

const NON_FORCED_MODEL = getProviderModels(NON_FORCED_PROVIDER)[0].id;
const FORCED_MODEL = getProviderModels(FORCED_PROVIDER)[0].id;

const JSON_UPSTREAM = {
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "upstream",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const SSE_UPSTREAM = [
  `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "upstream", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] })}`,
  `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "upstream", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
  "data: [DONE]",
  "",
].join("\n\n");

function makeBody(provider, model, extra = {}) {
  return {
    model: `${provider}/${model}`,
    max_tokens: 16,
    messages: [{ role: "user", content: "hi" }],
    ...extra,
  };
}

async function run({ provider, model, body, headers = {}, upstream = "json" }) {
  executeMock.mockImplementationOnce(async () => ({
    response: new Response(upstream === "json" ? JSON.stringify(JSON_UPSTREAM) : SSE_UPSTREAM, {
      status: 200,
      headers: { "content-type": upstream === "json" ? "application/json" : "text/event-stream" },
    }),
    url: "https://upstream.invalid/v1/chat/completions",
    headers: {},
    transformedBody: null,
  }));

  const result = await handleChatCore({
    body,
    modelInfo: { provider, model },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers },
    connectionId: "stream-default-test",
    sourceFormatOverride: "openai",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  return { result, call: executeMock.mock.calls.at(-1)?.[0] };
}

async function expectPlainJson(result) {
  expect(result.success).toBe(true);
  expect(result.response.headers.get("content-type")).toContain("application/json");
  const text = await result.response.text();
  expect(text).not.toContain("[DONE]");
  expect(() => JSON.parse(text)).not.toThrow();
  return JSON.parse(text);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("omitted `stream` (OpenAI semantics: JSON)", () => {
  it("answers a JSON client with plain JSON — no SSE framing, no [DONE] sentinel", async () => {
    const body = makeBody(NON_FORCED_PROVIDER, NON_FORCED_MODEL);
    const { result, call } = await run({ provider: NON_FORCED_PROVIDER, model: NON_FORCED_MODEL, body });

    expect(call.stream).toBe(false);
    const parsed = await expectPlainJson(result);
    expect(parsed.choices[0].message.content).toBe("ok");
  });

  it("sends the upstream body without a streaming claim", async () => {
    const body = makeBody(NON_FORCED_PROVIDER, NON_FORCED_MODEL);
    const { call } = await run({ provider: NON_FORCED_PROVIDER, model: NON_FORCED_MODEL, body });

    expect(call.body.stream).not.toBe(true);
  });

  it("still streams when the client asks for it", async () => {
    const body = makeBody(NON_FORCED_PROVIDER, NON_FORCED_MODEL, { stream: true });
    const { call } = await run({
      provider: NON_FORCED_PROVIDER, model: NON_FORCED_MODEL, body, upstream: "sse",
    });

    expect(call.stream).toBe(true);
    expect(call.body.stream).toBe(true);
    expect(call.body.messages).toEqual(body.messages);
  });

  it("keeps explicit `stream: false` on the JSON path", async () => {
    const body = makeBody(NON_FORCED_PROVIDER, NON_FORCED_MODEL, { stream: false });
    const { result, call } = await run({ provider: NON_FORCED_PROVIDER, model: NON_FORCED_MODEL, body });

    expect(call.stream).toBe(false);
    await expectPlainJson(result);
  });

  it("treats Accept: application/json + omitted stream as JSON", async () => {
    const body = makeBody(NON_FORCED_PROVIDER, NON_FORCED_MODEL);
    const { result, call } = await run({
      provider: NON_FORCED_PROVIDER, model: NON_FORCED_MODEL, body,
      headers: { accept: "application/json" },
    });

    expect(call.stream).toBe(false);
    await expectPlainJson(result);
  });
});

describe("omitted `stream` + streaming opt-in / forceStream providers", () => {
  it("treats Accept: text/event-stream + omitted stream as streaming, upstream included", async () => {
    const body = makeBody(NON_FORCED_PROVIDER, NON_FORCED_MODEL);
    const { call } = await run({
      provider: NON_FORCED_PROVIDER, model: NON_FORCED_MODEL, body,
      headers: { accept: "text/event-stream" },
      upstream: "sse",
    });

    expect(call.stream).toBe(true);
    expect(call.body.stream).toBe(true);
  });

  it("forceStream provider: omitted stream still reaches upstream as streaming and the client gets JSON", async () => {
    expect(PROVIDERS[FORCED_PROVIDER].forceStream).toBe(true);
    const body = makeBody(FORCED_PROVIDER, FORCED_MODEL);
    const { result, call } = await run({
      provider: FORCED_PROVIDER, model: FORCED_MODEL, body, upstream: "sse",
    });

    expect(call.stream).toBe(true);
    expect(call.body.stream).toBe(true);
    await expectPlainJson(result);
  });
});
