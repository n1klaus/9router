/**
 * Parse a status list typed in the CLI. Mirrors parseStatusesInput in
 * src/shared/utils/unhealthyStatuses.js (CLI is CommonJS and cannot import it).
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

module.exports = { parseStatusesCsv };
