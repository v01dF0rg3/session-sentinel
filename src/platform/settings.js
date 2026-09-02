/**
 * chrome.storage wrapper. Everything the extension remembers lives here, locally.
 * There is no account, no sync, and no network destination for any of it.
 */

import { DEFAULT_SETTINGS, withDefaults } from '../core/policy.js';
import { downgradeLegacyClaims } from '../core/legacy-claims.js';

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
 *   v6  remove the stale observed-login cache
 *   v7  downgrade pre-0.34 logout/revocation claims to unverified attempts
 *
 * @returns {Promise<Settings>}
 */
export async function migrateSettings() {
  const settings = await getSettings();
  if (settings.version >= 7) return settings;

  /** @type {Partial<Settings>} */
  const patch = { version: 7 };
  if (settings.version < 2) patch.notifications = false;
  if (settings.version < 3) patch.tabHandling = 'reload';
  if (settings.version < 5) patch.compromisePrompt = 'high';

  // v6 removed a permanent record of every domain ever judged signed in. It froze the
  // heuristic's mistakes: sites written in under a rule that mistook `nonsession` for an
  // auth cookie stayed listed after the rule was fixed, because nothing re-checked them.
  // Deleting the key matters as much as deleting the code - the stale answers live here.
  if (settings.version < 6) {
    try {
      await chrome.storage.local.remove('observedLogins');
    } catch {
      // A leftover key is inert once nothing reads it.
    }
  }

  // Records written before 0.34.0 did not distinguish a reached logout control from
  // independently verified server invalidation. Preserve their history, but display it
  // under the weaker safe meaning after upgrade.
  if (settings.version < 7) {
    try {
      const stored = await chrome.storage.local.get(['coverage', STATE_KEY]);
      const normalized = downgradeLegacyClaims(stored.coverage ?? {}, stored[STATE_KEY] ?? {});
      /** @type {Record<string, any>} */
      const legacyPatch = {};
      if (stored.coverage) legacyPatch.coverage = normalized.coverage;
      if (stored[STATE_KEY]) legacyPatch[STATE_KEY] = normalized.runtimeState;
      if (Object.keys(legacyPatch).length) await chrome.storage.local.set(legacyPatch);
    } catch {
      // Do not stamp v7 until the downgrade succeeds. Startup may continue with the old
      // settings, and the migration will retry the next time the extension starts.
      return settings;
    }
  }

  return updateSettings(patch);
}
