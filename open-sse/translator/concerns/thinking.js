// Concern: reasoning_effort ↔ provider-native thinking config.
// Central source of truth for level↔budget maps (web-standard values) and the
// shared wire facts used to pick a thinking format: which formats are native-only,
// how a target wire maps to a native format, and how provider/model/wire formats
// resolve to one effective format. Provider-specific application lives in
// thinkingUnified.js; this file owns the shared wire facts and maps (zero imports).

// Discrete effort levels, ordered low→high.
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];

// Web-standard level → budget_tokens (Anthropic/Gemini docs).
export const LEVEL_TO_BUDGET = {
  none: 0,
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
  max: 128000,
};

// Returns budget_tokens for an effort level, or undefined if unknown.
// 0 means "no thinking"; undefined means "effort not recognized".
export function effortToBudget(effort) {
  if (!effort) return undefined;
  return LEVEL_TO_BUDGET[String(effort).toLowerCase()];
}

// OpenAI reasoning_effort → Gemini thinkingLevel (gemini-3 enum: minimal|low|medium|high).
// Gemini 3 cannot fully disable thinking; "none"/"off" map to "minimal".
export function effortToThinkingLevel(effort) {
  const e = String(effort).toLowerCase().trim();
  if (e === "none" || e === "off") return "minimal";
  if (e === "xhigh" || e === "max") return "high";
  return e;
}

// Numeric budget → nearest discrete level (reverse map via thresholds).
// Returns null when budget <= 0 (no reasoning).
// Thresholds are midpoints between LEVEL_TO_BUDGET values: max (128000) is
// reachable, with the xhigh/max boundary at the 32768/128000 midpoint (80384).
export function budgetToLevel(budget) {
  const b = Number(budget);
  if (!b || b <= 0) return null;
  if (b <= 768) return "minimal";
  if (b <= 4096) return "low";
  if (b <= 16384) return "medium";
  if (b <= 28672) return "high";
  if (b <= 80384) return "xhigh";
  return "max";
}

// Gemini thinkingBudget (numeric) → OpenAI reasoning_effort (antigravity reverse map).
export function budgetToEffort(budget) {
  if (!budget || budget <= 0) return null;
  if (budget <= 2048) return "low";
  if (budget <= 16384) return "medium";
  return "high";
}

// Wire facts shared by the thinking pipeline: which formats are native-only (kept
// on their own wire even when the target wire is OpenAI-shaped), how a target wire
// maps to its native thinking format, and how provider/model/wire formats resolve
// to one effective format. Zero imports — dependency-free so thinkingLevels.js can
// import it without a cycle.

export const FORMAT_TO_NATIVE = {
  openai: "openai",
  "openai-responses": "openai",
  "openai-response": "openai",
  codex: "openai",
  claude: "claude-budget",
  gemini: "gemini-budget",
  "gemini-cli": "gemini-budget",
  vertex: "gemini-budget",
  antigravity: "gemini-budget",
  kiro: "kiro",
  commandcode: "commandcode",
};

export const NATIVE_ONLY_FORMATS = new Set([
  "gemini-level",
  "gemini-budget",
  "claude-budget",
  "claude-adaptive",
  "kiro",
  "minimax",
]);

export function isOpenAIWireFormat(format) {
  return format === "openai" || format === "openai-responses";
}

export function resolveThinkingFormat({ providerFormat, capsFormat, targetFormat }) {
  // Step 1: provider-declared format wins.
  if (providerFormat) return providerFormat;
  // Step 2: model's own format wins unless it is native-only and the target wire
  // is OpenAI-shaped — then fall through to the wire default below.
  if (capsFormat && !(isOpenAIWireFormat(targetFormat) && NATIVE_ONLY_FORMATS.has(capsFormat))) {
    return capsFormat;
  }
  // Step 3: the wire's default format.
  return FORMAT_TO_NATIVE[targetFormat] || "openai";
}
