// Shared helpers for the combo unhealthy-skip status selector.
// Statuses are stored as an array of HTTP codes, plus optional class markers:
// "4xx" = all 400-499, "5xx" = all 500-599. An empty array counts every error.

export const UNHEALTHY_CLASS_MARKERS = ["4xx", "5xx"];

/** Split a stored list into class markers and explicit codes. */
export function splitStatusClasses(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  return {
    classes: list.filter((s) => s === "4xx" || s === "5xx"),
    codes: list.filter((s) => s !== "4xx" && s !== "5xx"),
  };
}

/** True when a status counts: class marker match or explicit code match. */
export function matchesStatusClasses(status, statuses) {
  const { classes, codes } = splitStatusClasses(statuses);
  if (classes.length === 0 && codes.length === 0) return true; // empty = all errors
  const n = Number(status);
  if (classes.includes("4xx") && n >= 400 && n < 500) return true;
  if (classes.includes("5xx") && n >= 500 && n < 600) return true;
  return codes.map(Number).filter(Number.isFinite).includes(n);
}

/** Toggle a class marker in a stored list. */
export function toggleStatusClass(statuses, marker, on) {
  const list = Array.isArray(statuses) ? [...statuses] : [];
  const idx = list.findIndex((s) => s === marker || String(s) === marker);
  if (on && idx === -1) list.push(marker);
  if (!on && idx !== -1) list.splice(idx, 1);
  return list;
}

/**
 * Parse a status textbox. Returns null for empty/invalid input (caller keeps
 * current), [] for the explicit "all" token, otherwise the valid HTTP codes.
 */
export function parseStatusesInput(text) {
  const t = (text || "").trim();
  if (t === "") return null;
  if (t.toLowerCase() === "all") return [];
  const codes = t
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 100 && n < 600);
  return codes.length ? codes : null;
}

/** Display text for a stored list: classes first, then codes. */
export function formatStatusList(statuses) {
  const { classes, codes } = splitStatusClasses(statuses);
  return [...classes, ...codes].join(", ");
}

/** Display text for the explicit codes only (class markers excluded). */
export function formatStatusCodes(statuses) {
  return splitStatusClasses(statuses).codes.join(", ");
}

/**
 * Per-combo unhealthy-skip overrides resolved against global settings.
 * `??` (not `||`) so an explicit `[]` statuses list wins over the global list.
 */
export function resolveUnhealthyCfg(comboSpecific = {}, settings = {}) {
  return {
    threshold: comboSpecific.unhealthyThreshold ?? settings.comboUnhealthyThreshold,
    resetMs: comboSpecific.unhealthyResetMs ?? settings.comboUnhealthyResetMs,
    statuses: comboSpecific.unhealthyStatuses ?? settings.comboUnhealthyStatuses,
  };
}
