// Perch's BYOLM record shape, built outside the component so the "never write
// the sk_9router placeholder" contract is testable without rendering.
//
// Perch reads ~/.perch/byo-local.json and keeps only one scope=local /
// providerId=local record; every other record in that file belongs to the user.

export const PERCH_CONFIG_FILENAME = "~/.perch/byo-local.json";

// The dashboard's placeholder is not a real key. Perch writes this value to
// disk as a plaintext credential, so an empty key must become null, never "".
export const perchKey = (key) => (key === "sk_9router" ? "" : key || "");

// One `/v1` suffix, whatever the caller passed: strip trailing slashes first,
// or "http://h/v1/" becomes "http://h/v1//v1".
export const perchBaseUrl = (url) => {
  const trimmed = String(url || "").replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
};

export function buildPerchRecord({ baseUrl, apiKey, model, now = new Date().toISOString() }) {
  const key = perchKey(apiKey);
  return {
    userId: "local-device",
    providerId: "local",
    scope: "local",
    apiKeyCiphertext: key || null,
    baseUrl: perchBaseUrl(baseUrl),
    modelId: model,
    models: [{ id: model }],
    keyHint: key ? `…${key.slice(-4)}` : null,
    capabilityProfile: null,
    createdAt: now,
    updatedAt: now,
    _managedBy: "9router",
  };
}

export function buildPerchManualConfig({ baseUrl, apiKey, model }) {
  return [
    {
      filename: PERCH_CONFIG_FILENAME,
      content: JSON.stringify(
        { version: 1, records: [buildPerchRecord({ baseUrl, apiKey, model })] },
        null,
        2
      ),
    },
  ];
}
