/**
 * CLI twin of src/shared/utils/unhealthyStatuses.js (CLI is CommonJS and
 * cannot import it). Keep these values in sync with the shared constants:
 * UNHEALTHY_THRESHOLD_MIN/MAX, UNHEALTHY_RESET_MS_MIN/MAX, DEFAULT_UNHEALTHY_STATUSES.
 * tests/unit/cli-unhealthy-parity.test.js fails when this file drifts.
 * Exported so menus can interpolate the real bounds instead of hardcoding them.
 */
const UNHEALTHY_THRESHOLD_MIN = 1;
const UNHEALTHY_THRESHOLD_MAX = 20;
const UNHEALTHY_RESET_MS_MIN = 60 * 1000;
const UNHEALTHY_RESET_MS_MAX = 24 * 60 * 60 * 1000;
const DEFAULT_UNHEALTHY_STATUSES = [400, 401, 403, 404, 408, 429, 500, 502, 503, 504];

/**
 * Parse a status list typed in the CLI. Mirrors parseStatusesInput in
 * src/shared/utils/unhealthyStatuses.js (CLI is CommonJS and cannot import
 * it; tests/unit/cli-unhealthy-parity.test.js keeps the two in agreement).
 * Strict: any invalid token rejects the whole input.
 * @returns {null|Array} null = invalid (caller keeps current), [] = "all",
 *   else canonical list: class markers first, then ascending deduped codes 400-599
 */
function parseStatusesCsv(text) {
  const t = (text || "").trim();
  if (t === "") return null;
  if (t.toLowerCase() === "all") return [];
  if (/^[,;]/.test(t) || /[,;]$/.test(t) || /[,;]\s*[,;]/.test(t)) return null;
  const tokens = t.split(/[,;\s]+/).filter(Boolean);
  const markers = [];
  const codes = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "4xx" || lower === "5xx") { if (!markers.includes(lower)) markers.push(lower); continue; }
    if (!/^\d+$/.test(token)) return null;
    const n = Number(token);
    if (n < 400 || n >= 600) return null;
    if (!codes.includes(n)) codes.push(n);
  }
  markers.sort();
  codes.sort((a, b) => a - b);
  return [...markers, ...codes];
}

module.exports = {
  parseStatusesCsv,
  UNHEALTHY_THRESHOLD_MIN,
  UNHEALTHY_THRESHOLD_MAX,
  UNHEALTHY_RESET_MS_MIN,
  UNHEALTHY_RESET_MS_MAX,
  DEFAULT_UNHEALTHY_STATUSES,
};
