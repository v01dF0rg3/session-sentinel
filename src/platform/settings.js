/**
 * chrome.storage wrapper. Everything the extension remembers lives here, locally.
 * There is no account, no sync, and no network destination for any of it.
 */

import { DEFAULT_SETTINGS, withDefaults } from '../core/policy.js';

const SETTINGS_KEY = 'settings';
const STATE_KEY = 'runtimeState';

/** @typedef {import('../core/policy.js').Settings} Settings */

/**
 * @typedef {object} RuntimeState
 * @property {boolean} shutdownClean Set false while a browser session is live.
 * @property {string[]} pendingWipeDomains Queued when the browser closed mid-run.
 * @property {number} lastRunAt
 * @property {import('../engine/report.js').RunReport | null} lastReport
 */

/** @type {RuntimeState} */
const DEFAULT_STATE = {
  shutdownClean: true,
  pendingWipeDomains: [],
  lastRunAt: 0,
  lastReport: null
};

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return withDefaults(stored[SETTINGS_KEY]);
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>}
 */
export async function updateSettings(patch) {
  const next = withDefaults({ ...(await getSettings()), ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * @param {string} domain
 * @param {import('../core/policy.js').SiteOverride | null} override Null removes it.
 * @returns {Promise<Settings>}
 */
export async function setSiteOverride(domain, override) {
  const settings = await getSettings();
  const sites = { ...settings.sites };
  if (override) sites[domain] = override;
  else delete sites[domain];
  return updateSettings({ sites });
}

/** @returns {Promise<RuntimeState>} */
export async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return { ...DEFAULT_STATE, ...(stored[STATE_KEY] ?? {}) };
}

/**
 * @param {Partial<RuntimeState>} patch
 * @returns {Promise<RuntimeState>}
 */
export async function updateState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

/** Install-time seed so the first run is never operating on undefined. */
export async function ensureInitialized() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
}

/**
 * Apply settings migrations. Runs on install, on update, and at startup.
 *
 * Changed defaults do not reach existing users on their own - a stored value always wins -
 * so each behaviour change that matters needs a migration step here.
 *
 *   v2  notifications off, while they were a suspect in the browser crash
 *   v3  reload tabs after clearing, now that the crash is understood and fixed
 *   v4  warn before every per-site logout, not just high-risk ones
 *   v5  back to high-risk only, now that "Been hacked?" carries the same advice
 *
 * @returns {Promise<Settings>}
 */
export async function migrateSettings() {
  const settings = await getSettings();
  if (settings.version >= 5) return settings;

  /** @type {Partial<Settings>} */
  const patch = { version: 5 };
  if (settings.version < 2) patch.notifications = false;
  if (settings.version < 3) patch.tabHandling = 'reload';
  if (settings.version < 5) patch.compromisePrompt = 'high';

  return updateSettings(patch);
}
