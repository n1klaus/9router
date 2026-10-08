import { matchesStatusClasses } from "../../src/shared/utils/unhealthyStatuses.js";

/**
 * Combo unhealthy-model skip: sticky in-memory failure memory per combo/model.
 * Skip after N consecutive failures (within a reset window); re-admit lazily
 * after the window; success clears the streak. In-memory only — resets on
 * restart, like combo rotation state.
 */

const healthByCombo = new Map(); // comboName -> Map(modelStr -> { failures, firstFailureAt, skippedUntil })

function normalizeCfg(cfg = {}) {
  const threshold = Math.floor(+cfg.threshold);
  const resetMs = +cfg.resetMs;
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 3,
    resetMs: Number.isFinite(resetMs) && resetMs > 0 ? resetMs : 24 * 60 * 60 * 1000,
    statuses: Array.isArray(cfg.statuses) ? cfg.statuses.map((s) => (s === "4xx" || s === "5xx" ? s : Number(s))).filter((s) => s === "4xx" || s === "5xx" || Number.isFinite(s)) : [],
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

/** Empty status list = count every fallbackable failure. */
export function shouldCount(status, cfg = {}) {
  const { statuses } = normalizeCfg(cfg);
  return matchesStatusClasses(status, statuses);
}

export function recordComboFailure(comboName, modelStr, status, cfg = {}) {
  if (!shouldCount(status, cfg)) return;
  const c = normalizeCfg(cfg);
  const m = comboMap(comboName, true);
  const now = Date.now();
  const prev = m.get(modelStr);
  // Window-decayed streak: failures farther apart than resetMs start a new streak.
  const entry = prev && now - prev.firstFailureAt <= c.resetMs
    ? { failures: prev.failures + 1, firstFailureAt: prev.firstFailureAt, skippedUntil: prev.skippedUntil }
    : { failures: 1, firstFailureAt: now, skippedUntil: 0 };
  if (entry.failures >= c.threshold) entry.skippedUntil = now + c.resetMs;
  m.set(modelStr, entry);
}

export function recordComboSuccess(comboName, modelStr) {
  comboMap(comboName)?.delete(modelStr);
}

export function getSkippedModels(comboName, models, cfg = {}) {
  const c = normalizeCfg(cfg);
  const m = comboMap(comboName);
  if (!m) return [];
  const now = Date.now();
  const skipped = [];
  for (const [model, e] of m) {
    if (e.skippedUntil && e.skippedUntil > now) skipped.push(model);
    else if (e.skippedUntil) m.delete(model);                      // expired skip window
    else if (now - e.firstFailureAt > c.resetMs) m.delete(model);  // stale sub-threshold streak
  }
  return (models || []).filter((s) => skipped.includes(s));
}

export function resetComboHealth(comboName) {
  if (comboName) healthByCombo.delete(comboName);
  else healthByCombo.clear();
}
