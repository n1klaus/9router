// Shared helpers for the combo unhealthy-skip status selector.
// Statuses are stored as an array of HTTP codes, plus optional class markers:
// "4xx" = all 400-499, "5xx" = all 500-599. An empty array counts every error.

export const UNHEALTHY_CLASS_MARKERS = ["4xx", "5xx"];
export const DEFAULT_UNHEALTHY_STATUSES = [400, 401, 403, 404, 408, 429, 500, 502, 503, 504];
export const UNHEALTHY_THRESHOLD_MIN = 1;
export const UNHEALTHY_THRESHOLD_MAX = 20;
export const UNHEALTHY_RESET_MS_MIN = 60 * 1000;
export const UNHEALTHY_RESET_MS_MAX = 24 * 60 * 60 * 1000;

/** Integer 1-20. */
export function isValidThreshold(value) {
  return Number.isInteger(value) && value >= UNHEALTHY_THRESHOLD_MIN && value <= UNHEALTHY_THRESHOLD_MAX;
}

/** Whole milliseconds between 60 s and 24 h. */
export function isValidResetMs(value) {
  return Number.isInteger(value) && value >= UNHEALTHY_RESET_MS_MIN && value <= UNHEALTHY_RESET_MS_MAX;
}

/**
 * Validate a stored/API status list. Returns the canonical list (markers first,
 * then ascending deduped codes) or null when the value is not a valid list.
 * An empty array is valid and means "count every error".
 */
export function normalizeStatusesList(value) {
  if (!Array.isArray(value)) return null;
  const markers = [];
  const codes = [];
  for (const item of value) {
    // Marker tokens are case-insensitive: canonicalize "4XX"/"5XX" to lowercase
    // before validation. Everything else must already be an integer code, so
    // numeric strings like "404" still reject.
    const token = typeof item === "string" ? item.toLowerCase() : item;
    if (UNHEALTHY_CLASS_MARKERS.includes(token)) {
      if (!markers.includes(token)) markers.push(token);
      continue;
    }
    if (!Number.isInteger(token) || token < 400 || token >= 600) return null;
    if (!codes.includes(token)) codes.push(token);
  }
  markers.sort();
  codes.sort((a, b) => a - b);
  return [...markers, ...codes];
}

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
 * Parse a status textbox. Strict: any invalid token rejects the whole input.
 * Returns null for empty/invalid input (caller keeps current), [] for the
 * explicit "all" token, otherwise the canonical list. Separators: comma,
 * semicolon, whitespace. Accepted tokens: "all", "4xx", "5xx", integers 400-599.
 */
export function parseStatusesInput(text) {
  const t = (text || "").trim();
  if (t === "") return null;
  if (t.toLowerCase() === "all") return [];
  if (/^[,;]/.test(t) || /[,;]$/.test(t) || /[,;]\s*[,;]/.test(t)) return null;
  const tokens = t.split(/[,;\s]+/).filter(Boolean);
  const markers = [];
  const codes = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (UNHEALTHY_CLASS_MARKERS.includes(lower)) {
      if (!markers.includes(lower)) markers.push(lower);
      continue;
    }
    if (!/^\d+$/.test(token)) return null;
    const n = Number(token);
    if (n < 400 || n >= 600) return null;
    if (!codes.includes(n)) codes.push(n);
  }
  markers.sort();
  codes.sort((a, b) => a - b);
  return [...markers, ...codes];
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
 * Returns null when `comboUnhealthySkipEnabled === false`; callers pass the
 * result as handleComboChat's healthCfg, where null disables skipping.
 * Both params tolerate null (default params only cover undefined).
 */
export function resolveUnhealthyCfg(comboSpecific = {}, settings = {}) {
  const combo = comboSpecific || {};
  const cfg = settings || {};
  if (cfg.comboUnhealthySkipEnabled === false) return null;
  return {
    threshold: combo.unhealthyThreshold ?? cfg.comboUnhealthyThreshold,
    resetMs: combo.unhealthyResetMs ?? cfg.comboUnhealthyResetMs,
    statuses: combo.unhealthyStatuses ?? cfg.comboUnhealthyStatuses,
  };
}

/**
 * Drop per-combo unhealthy fields that fail validation (legacy/direct-DB data).
 * Returns a copy; unrelated keys and the source object are preserved.
 */
export function sanitizeUnhealthyOverrides(entry) {
  const out = { ...(entry || {}) };
  if (Object.prototype.hasOwnProperty.call(out, "unhealthyThreshold") && !isValidThreshold(out.unhealthyThreshold)) delete out.unhealthyThreshold;
  if (Object.prototype.hasOwnProperty.call(out, "unhealthyResetMs") && !isValidResetMs(out.unhealthyResetMs)) delete out.unhealthyResetMs;
  if (Object.prototype.hasOwnProperty.call(out, "unhealthyStatuses")) {
    const normalized = normalizeStatusesList(out.unhealthyStatuses);
    if (normalized === null) delete out.unhealthyStatuses;
    else out.unhealthyStatuses = normalized;
  }
  return out;
}

/** Validator for the global settings PATCH. Returns an error string or null. */
export function validateUnhealthySettingsPatch(body) {
  if (!body || typeof body !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(body, "comboUnhealthyThreshold") && !isValidThreshold(body.comboUnhealthyThreshold)) {
    return `comboUnhealthyThreshold must be an integer between ${UNHEALTHY_THRESHOLD_MIN} and ${UNHEALTHY_THRESHOLD_MAX}`;
  }
  if (Object.prototype.hasOwnProperty.call(body, "comboUnhealthyResetMs") && !isValidResetMs(body.comboUnhealthyResetMs)) {
    return `comboUnhealthyResetMs must be a whole number of milliseconds between ${UNHEALTHY_RESET_MS_MIN} and ${UNHEALTHY_RESET_MS_MAX}`;
  }
  if (Object.prototype.hasOwnProperty.call(body, "comboUnhealthyStatuses") && normalizeStatusesList(body.comboUnhealthyStatuses) === null) {
    return 'comboUnhealthyStatuses must be an array of HTTP codes 400-599 and/or "4xx"/"5xx" markers';
  }
  if (Object.prototype.hasOwnProperty.call(body, "comboUnhealthySkipEnabled") && typeof body.comboUnhealthySkipEnabled !== "boolean") {
    return "comboUnhealthySkipEnabled must be a boolean";
  }
  return null;
}

/** Validator for the per-combo overrides map. Returns an error string or null. */
export function validateComboStrategies(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "comboStrategies must be an object";
  for (const [name, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry !== "object" || Array.isArray(entry)) return `comboStrategies.${name} must be an object`;
    if (Object.prototype.hasOwnProperty.call(entry, "unhealthyThreshold") && !isValidThreshold(entry.unhealthyThreshold)) {
      return `comboStrategies.${name}.unhealthyThreshold must be an integer between ${UNHEALTHY_THRESHOLD_MIN} and ${UNHEALTHY_THRESHOLD_MAX}`;
    }
    if (Object.prototype.hasOwnProperty.call(entry, "unhealthyResetMs") && !isValidResetMs(entry.unhealthyResetMs)) {
      return `comboStrategies.${name}.unhealthyResetMs must be a whole number of milliseconds between ${UNHEALTHY_RESET_MS_MIN} and ${UNHEALTHY_RESET_MS_MAX}`;
    }
    if (Object.prototype.hasOwnProperty.call(entry, "unhealthyStatuses") && normalizeStatusesList(entry.unhealthyStatuses) === null) {
      return `comboStrategies.${name}.unhealthyStatuses must be an array of HTTP codes 400-599 and/or "4xx"/"5xx" markers`;
    }
  }
  return null;
}
