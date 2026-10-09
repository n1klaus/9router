const api = require("../api/client");
const { prompt, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { formatDate } = require("../utils/format");
const { selectModelFromList } = require("../utils/modelSelector");
const { parseStatusesCsv, UNHEALTHY_THRESHOLD_MIN, UNHEALTHY_THRESHOLD_MAX, UNHEALTHY_RESET_MS_MIN, UNHEALTHY_RESET_MS_MAX, DEFAULT_UNHEALTHY_STATUSES } = require("../utils/unhealthyStatuses");
const { showMenuWithBack } = require("../utils/menuHelper");

// Reset-window prompt bounds in minutes, derived from the ms constants so the
// copy and validation always match the shared limits.
const RESET_MIN_MINUTES = UNHEALTHY_RESET_MS_MIN / 60000;
const RESET_MAX_MINUTES = UNHEALTHY_RESET_MS_MAX / 60000;

/**
 * Format model to string (handle both string and object)
 */
function formatModel(model) {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    return model.id || model.name || `${model.provider}/${model.model}` || JSON.stringify(model);
  }
  return String(model);
}


/**
 * Show actions for a specific combo
 * @param {Object} combo - Combo object
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showComboActions(combo, breadcrumb = []) {
  const modelsChain = Array.isArray(combo.models) 
    ? combo.models.map(formatModel).join(" → ") 
    : "";
  
  await showMenuWithBack({
    title: `🔀 ${combo.name}`,
    breadcrumb: [...breadcrumb, combo.name],
    headerContent: `Name: ${combo.name}\nModels: ${modelsChain}`,
    items: [
      {
        label: "Edit Combo",
        action: async () => {
          await handleEditSingleCombo(combo);
          return true;
        }
      },
      {
        label: "Delete Combo",
        action: async () => {
          await handleDeleteSingleCombo(combo);
          return false; // Exit after delete
        }
      }
    ]
  });
}


/**
 * Handle editing a single combo
 * @param {Object} combo - Combo to edit
 */
async function handleEditSingleCombo(combo) {
  clearScreen();
  console.log(`\n✏️  Edit Combo: ${combo.name}\n`);
  
  const newName = await prompt(`New name (Enter to keep "${combo.name}"): `);
  const name = newName || combo.name;
  
  console.log("\nCurrent models: " + (Array.isArray(combo.models) ? combo.models.map(formatModel).join(" → ") : ""));
  console.log("\nSelect models for this combo (add one by one):");
  
  const models = [];
  let addMore = true;
  
  while (addMore) {
    const currentChain = models.length > 0 ? models.join(" → ") : "None";
    const model = await selectModelFromList(`Add Model #${models.length + 1}`, `Chain: ${currentChain}`);
    
    if (model) {
      models.push(model);
      console.log(`\n✓ Added: ${model}`);
      console.log(`Current chain: ${models.join(" → ")}\n`);
      
      const continueAdding = await confirm("Add another model?");
      addMore = continueAdding;
    } else {
      addMore = false;
    }
  }
  
  // Use new models if any were added, otherwise keep current
  const finalModels = models.length > 0 ? models : combo.models;
  // Per-combo unhealthy-skip overrides live in settings.comboStrategies[name],
  // not on the combo record. Enter = keep, "-" = inherit global.
  // Renames migrate the entry: read the old key, write the new one.
  const settingsRes = await api.getSettings();
  if (!settingsRes.success) {
    // Never write comboStrategies from a failed read: it would drop every other combo's entry.
    showStatus(`Failed to load settings: ${settingsRes.error} — skipped unhealthy-skip overrides`, "error");
  } else {
    const settingsData = settingsRes.data || {};
    const comboStrategies = { ...(settingsData.comboStrategies || {}) };
    const override = { ...(comboStrategies[combo.name] || {}) };
    let changed = false;
    console.log("\nUnhealthy skip (Enter = keep, '-' = inherit global):");

    const thRaw = ((await prompt(`  Threshold ${UNHEALTHY_THRESHOLD_MIN}-${UNHEALTHY_THRESHOLD_MAX} (global ${settingsData.comboUnhealthyThreshold ?? 3}): `)) || "").trim();
    if (thRaw === "-") {
      if ("unhealthyThreshold" in override) { delete override.unhealthyThreshold; changed = true; }
    } else if (thRaw !== "") {
      const n = Number(thRaw);
      if (/^\d+$/.test(thRaw) && Number.isInteger(n) && n >= UNHEALTHY_THRESHOLD_MIN && n <= UNHEALTHY_THRESHOLD_MAX) {
        if (override.unhealthyThreshold !== n) { override.unhealthyThreshold = n; changed = true; }
      } else showStatus(`Invalid threshold "${thRaw}" (${UNHEALTHY_THRESHOLD_MIN}-${UNHEALTHY_THRESHOLD_MAX}) — kept current`, "error");
    }

    const gMs = settingsData.comboUnhealthyResetMs ?? 86400000;
    const resetGlobalLabel = gMs % 60000 === 0 ? `${gMs / 60000}` : `${(gMs / 60000).toFixed(2).replace(/\.?0+$/, "")} (${gMs} ms)`;
    const resetRaw = ((await prompt(`  Reset minutes ${RESET_MIN_MINUTES}-${RESET_MAX_MINUTES}, decimals allowed e.g. 1.5 = 90s (global ${resetGlobalLabel}): `)) || "").trim();
    if (resetRaw === "-") {
      if ("unhealthyResetMs" in override) { delete override.unhealthyResetMs; changed = true; }
    } else if (resetRaw !== "") {
      const minutes = Number(resetRaw);
      const ms = Math.round(minutes * 60000);
      if (/^\d+(\.\d+)?$/.test(resetRaw) && Number.isFinite(minutes) && minutes >= RESET_MIN_MINUTES && minutes <= RESET_MAX_MINUTES && Number.isInteger(ms) && ms >= UNHEALTHY_RESET_MS_MIN && ms <= UNHEALTHY_RESET_MS_MAX) {
        if (override.unhealthyResetMs !== ms) { override.unhealthyResetMs = ms; changed = true; }
      } else showStatus(`Invalid reset window "${resetRaw}" (${RESET_MIN_MINUTES}-${RESET_MAX_MINUTES} minutes) — kept current`, "error");
    }

    const statusesGlobal = Array.isArray(settingsData.comboUnhealthyStatuses) ? settingsData.comboUnhealthyStatuses : [...DEFAULT_UNHEALTHY_STATUSES]; // server default when missing
    const curStatuses = Array.isArray(override.unhealthyStatuses) ? override.unhealthyStatuses : undefined;
    const statusesLabel = curStatuses === undefined
      ? `global ${statusesGlobal.join(",") || "all"}`
      : (curStatuses.length === 0 ? "all" : curStatuses.join(","));
    const stRaw = ((await prompt(`  Statuses csv or "all" (codes 400-599, 4xx/5xx) (${statusesLabel}): `)) || "").trim();
    if (stRaw === "-") {
      if ("unhealthyStatuses" in override) { delete override.unhealthyStatuses; changed = true; }
    } else if (stRaw !== "") {
      const parsed = parseStatusesCsv(stRaw);
      if (parsed === null) showStatus(`Invalid status list "${stRaw}" — kept current`, "error");
      else if (JSON.stringify(parsed) !== JSON.stringify(curStatuses ?? null)) { override.unhealthyStatuses = parsed; changed = true; }
    }

    // On rename collision (target already has an entry, e.g. concurrent edit),
    // merge instead of clobbering: target keys win, carried keys fill the gaps.
    const targetEntry = name !== combo.name ? comboStrategies[name] : undefined;
    const merged = targetEntry && typeof targetEntry === "object" && !Array.isArray(targetEntry)
      ? { ...override, ...targetEntry }
      : override;

    // Skip the PATCH when nothing changed: writing comboStrategies resets the
    // server's in-memory health state for every combo.
    if (changed || (name !== combo.name && Object.prototype.hasOwnProperty.call(comboStrategies, combo.name))) {
      if (name !== combo.name) delete comboStrategies[combo.name];
      if (!merged.fallbackStrategy || merged.fallbackStrategy === "fallback") delete merged.fallbackStrategy;
      if (Object.keys(merged).length === 0) delete comboStrategies[name];
      else comboStrategies[name] = merged;
      const strategySync = await api.updateSettings({ comboStrategies });
      if (!strategySync.success) showStatus(`Unhealthy-skip settings failed: ${strategySync.error}`, "error");
    }
  }
  
  const result = await api.updateCombo(combo.id, { name, models: finalModels });
  
  if (result.success) {
    showStatus("Combo updated!", "success");
  } else {
    showStatus(`Update failed: ${result.error}`, "error");
  }
  await pause();
}


/**
 * Handle deleting a single combo
 * @param {Object} combo - Combo to delete
 */
async function handleDeleteSingleCombo(combo) {
  const confirmed = await confirm(`Delete combo "${combo.name}"?`);
  if (confirmed) {
    const result = await api.deleteCombo(combo.id);
    if (result.success) {
      showStatus("Combo deleted!", "success");
    } else {
      showStatus(`Delete failed: ${result.error}`, "error");
    }
    await pause();
  }
}


/**
 * Main combos menu - list all combos and actions
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showCombosMenu(breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");
  
  await showListMenu({
    title: "🔀 Combos Management",
    breadcrumb,
    fetchItems: async () => {
      const result = await api.getCombos();
      if (!result.success) {
        clearScreen();
        showStatus(`Failed to load combos: ${result.error}`, "error");
        await pause();
        return null;
      }
      return { items: result.data.combos || [] };
    },
    formatItem: (combo) => {
      const modelsChain = Array.isArray(combo.models) ? combo.models.map(formatModel).join(" → ") : "";
      const maxLen = 35;
      const displayModels = modelsChain.length > maxLen 
        ? modelsChain.substring(0, maxLen - 3) + "..." 
        : modelsChain;
      return `${combo.name}: ${displayModels}`;
    },
    onSelect: async (combo) => {
      await showComboActions(combo, breadcrumb);
    },
    createAction: {
      label: "Create New Combo",
      action: async () => {
        await handleCreateCombo();
      }
    }
  });
}


/**
 * Show combo detail with stats
 */
async function showComboDetail(comboId) {
  clearScreen();
  
  const result = await api.getComboById(comboId);
  
  if (!result.success) {
    showStatus(`Failed to load combo: ${result.error}`, "error");
    await pause();
    return;
  }
  
  const combo = result.data;
  
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log(`│  🔀 Combo: ${combo.name.padEnd(46)} │`);
  console.log("├─────────────────────────────────────────────────────────┤");
  console.log("│                                                          │");
  console.log(`│  ID: ${combo.id.padEnd(51)} │`);
  console.log(`│  Created: ${formatDate(combo.createdAt).padEnd(46)} │`);
  console.log(`│  Updated: ${formatDate(combo.updatedAt).padEnd(46)} │`);
  console.log("│                                                          │");
  console.log("│  Model Chain:                                           │");
  
  // Models is array of strings like ["ag/claude-sonnet-4-5", "kr/claude-sonnet-4.5"]
  const models = Array.isArray(combo.models) ? combo.models : [];
  models.forEach((modelStr, index) => {
    const arrow = index < models.length - 1 ? " →" : "  ";
    const displayText = `${index + 1}. ${modelStr}${arrow}`;
    const padding = Math.max(0, 54 - displayText.length);
    console.log(`│    ${displayText}${" ".repeat(padding)} │`);
  });
  
  console.log("│                                                          │");
  console.log("└─────────────────────────────────────────────────────────┘");
  
  await pause();
}


/**
 * Format combo for menu display
 */
function formatComboLabel(combo) {
  const modelsChain = Array.isArray(combo.models) ? combo.models.map(formatModel).join(" → ") : "";
  const maxLen = 40;
  const displayModels = modelsChain.length > maxLen 
    ? modelsChain.substring(0, maxLen - 3) + "..." 
    : modelsChain;
  return `${combo.name}: ${displayModels}`;
}


/**
 * Create new combo
 */
async function handleCreateCombo() {
  clearScreen();
  
  showStatus("Create New Combo", "info");
  console.log();
  
  // Get combo name
  const name = await prompt("Combo name: ");
  if (!name) {
    showStatus("Combo name is required", "error");
    await pause();
    return;
  }
  
  // Fetch available models
  showStatus("Loading available models...", "info");
  const modelsResult = await api.getModels();
  
  if (!modelsResult.success) {
    showStatus(`Failed to load models: ${modelsResult.error}`, "error");
    await pause();
    return;
  }
  
  const availableModels = modelsResult.data.models || [];
  
  if (availableModels.length === 0) {
    showStatus("No models available. Please add providers first.", "warning");
    await pause();
    return;
  }
  
  // Select models for chain
  const selectedModels = [];
  
  console.log();
  showStatus("Select models for the chain (minimum 2)", "info");
  
  while (true) {
    clearScreen();
    console.log(`Creating combo: ${name}`);
    console.log(`Selected models (${selectedModels.length}):`);
    
    if (selectedModels.length > 0) {
      selectedModels.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.provider}/${m.model}`);
      });
    } else {
      console.log("  (none)");
    }
    
    console.log();
    console.log("Available models:");
    availableModels.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.provider}/${m.model}`);
    });
    
    console.log();
    console.log("Actions:");
    console.log("  - Enter number to add model");
    console.log("  - Type 'done' to finish (min 2 models)");
    console.log("  - Type 'cancel' to abort");
    
    const input = await prompt("\nAction: ");
    
    if (input.toLowerCase() === "cancel") {
      showStatus("Cancelled", "warning");
      await pause();
      return;
    }
    
    if (input.toLowerCase() === "done") {
      if (selectedModels.length < 2) {
        showStatus("Please select at least 2 models", "error");
        await pause();
        continue;
      }
      break;
    }
    
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > availableModels.length) {
      showStatus("Invalid model number", "error");
      await pause();
      continue;
    }
    
    selectedModels.push(availableModels[num - 1]);
  }
  
  // Create combo
  showStatus("Creating combo...", "info");
  
  const createResult = await api.createCombo({
    name,
    models: selectedModels
  });
  
  if (!createResult.success) {
    showStatus(`Failed to create combo: ${createResult.error}`, "error");
    await pause();
    return;
  }
  
  showStatus(`Combo "${name}" created successfully!`, "success");
  await pause();
}

module.exports = { showCombosMenu };
