# Perch CLI (BYOLM)

Perch (`perchai-cli`) can run its turns against any OpenAI-compatible endpoint.
9Router registers itself as that endpoint through Perch's BYOLM (bring your own
local model) store. 9Router never proxies Perch-hosted models; Perch sends its
model calls directly to the endpoint below.

## Configure

- Dashboard: CLI Tools → Perch CLI → select endpoint, API key, and model → Apply.
- CLI: `9router connect <server-url> --tools perch --model <model>`
- Perch: `perch byolm set http://localhost:20128/v1 <model> --key <key>`

`http://localhost` is valid for BYOLM. `byok` is Perch's cloud-key path; use
BYOLM for a local 9Router endpoint.

## What 9Router writes

`~/.perch/byo-local.json` (or `$PERCH_HOME/byo-local.json`) gets one record with
`scope: "local"` and `providerId: "local"`. Other records in the file are left
alone. Removing the tool deletes only that record. The file holds the API key,
so 9Router rewrites it with mode 0600.

## Verify

    perch byolm status   # Local model: active (BYOLM).
    perch byolm test     # one small chat completion with a tool call

## Terms of service

Perch's terms treat bring-your-own-key / self-hosted model usage as your own
third-party credentials and costs. They do not allow calling, automating,
proxying, reselling, or exposing Perch's internal hosted-model endpoints as an
API, and Perch-hosted models are only available through Perch's own Web,
Desktop, and CLI surfaces. This integration stays on
the allowed side: it writes the BYOLM record and nothing else. Do not intercept
Perch traffic or route Perch-hosted models through 9Router.

Perch's CLI describes BYOLM as: "Turns run on your machine: not metered, never
falls back to a hosted model."
