/**
 * Parse a status list typed in the CLI. Mirrors parseStatusesInput in
 * src/shared/utils/unhealthyStatuses.js (CLI is CommonJS and cannot import it).
 * @returns {null|Array} null = invalid (caller keeps current), [] = "all", else codes 100-599
 */
function parseStatusesCsv(text) {
  const t = (text || "").trim();
  if (t === "") return null;
  if (t.toLowerCase() === "all") return [];
  const codes = t.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 100 && n < 600);
  return codes.length ? codes : null;
}

module.exports = { parseStatusesCsv };
