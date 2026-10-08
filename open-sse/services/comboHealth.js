import { DEFAULT_UNHEALTHY_STATUSES, matchesStatusClasses } from "../../src/shared/utils/unhealthyStatuses.js";

/**
 * Combo unhealthy-model skip: sticky in-memory failure memory per combo/model.
 * Skip after N consecutive failures (each within one reset window of the previous);
 * a skip lasts at most one reset window; success clears the streak. In-memory only —
 * per server process (multi-process deployments keep independent state), like combo
 * rotation state.
 */

const healthByCombo = new Map(); // comboName -> Map(modelStr -> { failures, lastFailureAt, skippedUntil })

function normalizeCfg(cfg = {}) {
  const threshold = Math.floor(+cfg.threshold);
  const resetMs = +cfg.resetMs;
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 3,
    resetMs: Number.isFinite(resetMs) && resetMs > 0 ? resetMs : 24 * 60 * 60 * 1000,
    statuses: Array.isArray(cfg.statuses)
      ? cfg.statuses
          .map((s) => (s === "4xx" || s === "5xx" ? s : Number(s)))
          .filter((s) => s === "4xx" || s === "5xx" || (Number.isInteger(s) && s >= 400 && s < 600))
      : DEFAULT_UNHEALTHY_STATUSES,
  };
}

function comboMap(name, create = false) {
  const key = name || "__default__";
  let m = healthByCombo.get(key);
  if (!m && create) {
    m = new Map();
    healthByCombo.set(key, m);
  }
  return m;
}

/**
 * Empty status list = count every fallbackable failure. A null status means the
 * attempt threw before producing a response (transport failure): it always counts.
 */
export function shouldCount(status, cfg = {}) {
  if (status === null) return true;
  const { statuses } = normalizeCfg(cfg);
  return matchesStatusClasses(status, statuses);
}

export function recordComboFailure(comboName, modelStr, status, cfg = {}) {
  if (!shouldCount(status, cfg)) return;
  const c = normalizeCfg(cfg);
  const m = comboMap(comboName, true);
  const now = Date.now();
  const prev = m.get(modelStr);
  // Streak decays when the previous failure is farther back than one reset window.
  const entry = prev && now - prev.lastFailureAt <= c.resetMs
    ? { failures: prev.failures + 1, lastFailureAt: now, skippedUntil: prev.skippedUntil }
    : { failures: 1, lastFailureAt: now, skippedUntil: 0 };
  // Set the window once, at the crossing: a skip never outlives one reset window.
  if (entry.failures >= c.threshold && !entry.skippedUntil) entry.skippedUntil = now + c.resetMs;
  m.set(modelStr, entry);
}

export function recordComboSuccess(comboName, modelStr) {
  comboMap(comboName)?.delete(modelStr);
}

export function getSkippedModels(comboName, models, cfg = {}) {
  const c = normalizeCfg(cfg);
  const m = comboMap(comboName);
  if (!m) return [];
  const members = Array.isArray(models) ? new Set(models) : null;
  const now = Date.now();
  const skipped = [];
  for (const [model, e] of m) {
    if (members && !members.has(model)) { m.delete(model); continue; } // model left the combo
    if (e.skippedUntil && e.skippedUntil > now) skipped.push(model);
    else if (e.skippedUntil) m.delete(model);                          // expired skip window
    else if (now - e.lastFailureAt > c.resetMs) m.delete(model);       // stale sub-threshold streak
  }
  return skipped;
}

export function resetComboHealth(comboName) {
  if (comboName) healthByCombo.delete(comboName);
  else healthByCombo.clear();
}
