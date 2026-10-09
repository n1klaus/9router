const api = require("../api/client");
const { confirm, pause, prompt } = require("../utils/input");
const { parseStatusesCsv, UNHEALTHY_THRESHOLD_MIN, UNHEALTHY_THRESHOLD_MAX, UNHEALTHY_RESET_MS_MIN, UNHEALTHY_RESET_MS_MAX, DEFAULT_UNHEALTHY_STATUSES } = require("../utils/unhealthyStatuses");
const { showStatus } = require("../utils/display");
const { showMenuWithBack } = require("../utils/menuHelper");

// ANSI colors
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m"
};

const DEFAULT_PASSWORD = "123456";

// Reset-window prompt bounds in minutes, derived from the ms constants so the
// copy and validation always match the shared limits.
const RESET_MIN_MINUTES = UNHEALTHY_RESET_MS_MIN / 60000;
const RESET_MAX_MINUTES = UNHEALTHY_RESET_MS_MAX / 60000;

/**
 * Show settings menu (tunnel + RTK + reset password)
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showSettingsMenu(breadcrumb = []) {
  await showMenuWithBack({
    title: "⚙️  Settings",
    breadcrumb,
    headerContent: async (data) => {
      const lines = [];

      // Tunnel section
      const tunnel = data?.tunnel || {};
      if (tunnel.enabled && tunnel.publicUrl) {
        lines.push(`  Endpoint: ${COLORS.green}${tunnel.publicUrl}/v1${COLORS.reset}`);
        lines.push(`  Tunnel:   ${COLORS.green}ON${COLORS.reset} ${COLORS.dim}(${tunnel.shortId})${COLORS.reset}`);
      } else {
        lines.push(`  Endpoint: http://localhost:20128/v1`);
        lines.push(`  Tunnel:   ${COLORS.red}OFF${COLORS.reset} ${COLORS.dim}(local only)${COLORS.reset}`);
      }

      // RTK section
      const rtkOn = data?.settings?.rtkEnabled !== false;
      lines.push(`  RTK:      ${rtkOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(Token Saver)${COLORS.reset}`);
      const headroomOn = data?.settings?.headroomEnabled === true;
      lines.push(`  Headroom: ${headroomOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(${data?.settings?.headroomUrl || "http://localhost:8787"})${COLORS.reset}`);

      // Auth mode section
      const authMode = data?.settings?.authMode || "password";
      const authColor = authMode === "password" ? COLORS.green : COLORS.yellow;
      lines.push(`  Auth:     ${authColor}${authMode.toUpperCase()}${COLORS.reset} ${COLORS.dim}(login mode)${COLORS.reset}`);

      return lines.join("\n");
    },
    refresh: async () => {
      const [tunnelRes, settingsRes] = await Promise.all([
        api.getTunnelStatus(),
        api.getSettings()
      ]);
      return {
        tunnel: tunnelRes.success ? (tunnelRes.data || {}) : {},
        settings: settingsRes.success ? (settingsRes.data || {}) : {}
      };
    },
    items: [
      {
        label: "Tunnel ON",
        action: async () => { await enableTunnel(); return true; }
      },
      {
        label: "Tunnel OFF",
        action: async () => { await disableTunnel(); return true; }
      },
      {
        label: (d) => {
          const on = d?.settings?.rtkEnabled !== false;
          return `Token Saver (RTK): ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => { await toggleRtk(d?.settings?.rtkEnabled !== false); return true; }
      },
      {
        label: (d) => {
          const on = d?.settings?.headroomEnabled === true;
          return `Token Saver (Headroom): ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => { await toggleHeadroom(d?.settings?.headroomEnabled === true); return true; }
      },
      {
        label: (d) => {
          const on = d?.settings?.comboUnhealthySkipEnabled !== false;
          return `Combo unhealthy skip: ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => { await toggleComboUnhealthySkip(d?.settings?.comboUnhealthySkipEnabled !== false); return true; }
      },
      {
        label: (d) => `Combo unhealthy: failure threshold (current ${d?.settings?.comboUnhealthyThreshold ?? 3})`,
        action: async (d) => { await setComboUnhealthyThreshold(d?.settings?.comboUnhealthyThreshold ?? 3); return true; }
      },
      {
        label: (d) => {
          const ms = d?.settings?.comboUnhealthyResetMs ?? 86400000;
          const shown = ms % 60000 === 0 ? `${ms / 60000} min` : `${(ms / 60000).toFixed(2).replace(/\.?0+$/, "")} min (${ms} ms)`;
          return `Combo unhealthy: reset window (current ${shown})`;
        },
        action: async (d) => { await setComboUnhealthyReset(d?.settings?.comboUnhealthyResetMs ?? 86400000); return true; }
      },
      {
        label: (d) => {
          const statuses = Array.isArray(d?.settings?.comboUnhealthyStatuses)
            ? d.settings.comboUnhealthyStatuses
            : [...DEFAULT_UNHEALTHY_STATUSES]; // server default when settings value missing
          return `Combo unhealthy: status codes (current ${statuses.join(",") || "all"})`;
        },
        action: async (d) => { await setComboUnhealthyStatuses(Array.isArray(d?.settings?.comboUnhealthyStatuses) ? d.settings.comboUnhealthyStatuses : [...DEFAULT_UNHEALTHY_STATUSES]); return true; }
      },
      {
        label: "🔑 Reset Password to Default",
        action: async () => { await resetPassword(); return true; }
      },
      {
        label: (d) => {
          const mode = d?.settings?.authMode || "password";
          return mode === "password" ? "🔓 Reset Auth Mode (already password)" : `🔓 Reset Auth Mode to Password (current: ${mode})`;
        },
        action: async () => { await resetAuthMode(); return true; }
      }
    ]
  });
}

/**
 * Reset authMode to "password" via API. Used when OIDC is misconfigured
 * and user is locked out of dashboard. CLI bypasses auth via x-9r-cli-token.
 */
async function resetAuthMode() {
  const ok = await confirm("Reset auth mode to PASSWORD (disable OIDC)?");
  if (!ok) {
    showStatus("Cancelled", "info");
    await pause();
    return;
  }

  const result = await api.updateSettings({ authMode: "password" });
  if (result.success) {
    showStatus("Auth mode reset to password. OIDC disabled.", "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  await pause();
}

/**
 * Enable tunnel via API
 */
async function enableTunnel() {
  showStatus("Creating tunnel...", "info");
  const result = await api.enableTunnel();

  if (result.success) {
    const { publicUrl, shortId, alreadyRunning } = result.data || {};
    if (alreadyRunning) {
      showStatus(`Tunnel already running: ${publicUrl}`, "success");
    } else {
      showStatus(`Tunnel enabled: ${publicUrl} (${shortId})`, "success");
    }
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }

  await pause();
}

/**
 * Disable tunnel via API
 */
async function disableTunnel() {
  const result = await api.disableTunnel();

  if (result.success) {
    showStatus("Tunnel disabled", "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }

  await pause();
}

/**
 * Toggle RTK (Token Saver) via API
 * @param {boolean} currentlyOn
 */
async function toggleRtk(currentlyOn) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ rtkEnabled: next });
  if (result.success) {
    showStatus(`Token Saver ${next ? "enabled" : "disabled"}`, "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  await pause();
}

async function toggleHeadroom(currentlyOn) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ headroomEnabled: next });
  if (result.success) {
    showStatus(`Headroom ${next ? "enabled" : "disabled"}`, "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  await pause();
}

/**
 * Toggle combo unhealthy-skip globally via API (default ON; false disables
 * skipping server-side for every combo without a per-combo override).
 * @param {boolean} currentlyOn
 */
async function toggleComboUnhealthySkip(currentlyOn) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ comboUnhealthySkipEnabled: next });
  if (result.success) {
    showStatus(`Combo unhealthy skip ${next ? "enabled" : "disabled"}`, "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  await pause();
}
/**
 * Set global combo unhealthy-skip failure threshold via API
 * @param {number} current - Current threshold
 */
async function setComboUnhealthyThreshold(current) {
  const raw = ((await prompt(`Failure threshold ${UNHEALTHY_THRESHOLD_MIN}-${UNHEALTHY_THRESHOLD_MAX} (current ${current}, Enter to keep): `)) || "").trim();
  if (raw === "") { showStatus("Kept current threshold", "info"); await pause(); return; }
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < UNHEALTHY_THRESHOLD_MIN || n > UNHEALTHY_THRESHOLD_MAX) {
    showStatus(`Invalid threshold "${raw}" (${UNHEALTHY_THRESHOLD_MIN}-${UNHEALTHY_THRESHOLD_MAX}) — kept current`, "error");
    await pause();
    return;
  }
  const result = await api.updateSettings({ comboUnhealthyThreshold: n });
  if (result.success) showStatus(`Combo unhealthy threshold set to ${n}`, "success");
  else showStatus(`Failed: ${result.error}`, "error");
  await pause();
}

/**
 * Set global combo unhealthy-skip reset window via API
 * @param {number} currentMs - Current reset window in ms
 */
async function setComboUnhealthyReset(currentMs) {
  // The server accepts any whole number of milliseconds in [60s, 24h]; the CLI
  // prompts in minutes but accepts decimals so sub-minute values are preserved.
  const fmt = (ms) => (ms % 60000 === 0 ? `${ms / 60000} min` : `${(ms / 60000).toFixed(2).replace(/\.?0+$/, "")} min (${ms} ms)`);
  const raw = ((await prompt(`Reset window minutes ${RESET_MIN_MINUTES}-${RESET_MAX_MINUTES}, decimals allowed e.g. 1.5 = 90s (current ${fmt(currentMs)}, Enter to keep): `)) || "").trim();
  if (raw === "") { showStatus("Kept current reset window", "info"); await pause(); return; }
  const minutes = Number(raw);
  const ms = Math.round(minutes * 60000);
  // /^\d+(\.\d+)?$/ keeps decimal minutes (1.5 = 90 s) but rejects hex/exponent forms.
  if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(minutes) || minutes < RESET_MIN_MINUTES || minutes > RESET_MAX_MINUTES || !Number.isInteger(ms) || ms < UNHEALTHY_RESET_MS_MIN || ms > UNHEALTHY_RESET_MS_MAX) {
    showStatus(`Invalid reset window "${raw}" (${RESET_MIN_MINUTES}-${RESET_MAX_MINUTES} minutes) — kept current`, "error");
    await pause();
    return;
  }
  const result = await api.updateSettings({ comboUnhealthyResetMs: ms });
  if (result.success) showStatus(`Combo unhealthy reset window set to ${fmt(ms)}`, "success");
  else showStatus(`Failed: ${result.error}`, "error");
  await pause();
}

/**
 * Set global combo unhealthy-skip counted status codes via API
 * @param {Array<number>} current - Current status list (empty = all errors)
 */
async function setComboUnhealthyStatuses(current) {
  const label = (current || []).join(",") || "all";
  const raw = ((await prompt(`Statuses csv or "all" (codes 400-599, "4xx"/"5xx") (current ${label}, Enter to keep): `)) || "").trim();
  if (raw === "") { showStatus("Kept current status list", "info"); await pause(); return; }
  const statuses = parseStatusesCsv(raw);
  if (statuses === null) {
    showStatus(`Invalid status list "${raw}" — kept current`, "error");
    await pause();
    return;
  }
  const result = await api.updateSettings({ comboUnhealthyStatuses: statuses });
  if (result.success) showStatus(`Combo unhealthy statuses set to ${statuses.join(",") || "all"}`, "success");
  else showStatus(`Failed: ${result.error}`, "error");
  await pause();
}

/**
 * Reset dashboard password to default via server API (writes the live SQLite DB).
 * After reset, user can log in with the default password "123456".
 */
async function resetPassword() {
  const ok = await confirm(`Reset dashboard password to default "${DEFAULT_PASSWORD}"?`);
  if (!ok) {
    showStatus("Cancelled", "info");
    await pause();
    return;
  }

  const result = await api.resetPassword();
  if (result.success) {
    showStatus(`Password reset. Default: ${DEFAULT_PASSWORD}`, "success");
  } else {
    showStatus(`Failed to reset password: ${result.error}`, "error");
  }
  await pause();
}

module.exports = { showSettingsMenu };
