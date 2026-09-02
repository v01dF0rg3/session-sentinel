/**
 * Login flows explicitly started from the candidate list.
 *
 * Stored in chrome.storage.session so MV3 may stop and restart the service worker while
 * the person types a password without losing the connection between that tab and the
 * account being checked. Intents expire quickly and disappear when their tab closes.
 */

const KEY = 'pendingLoginIntents';
const MAX_AGE_MS = 30 * 60 * 1000;

/**
 * @typedef {object} LoginIntent
 * @property {string} domain
 * @property {boolean} attemptedEntry
 * @property {number} at
 */

/** @returns {Promise<Record<string, LoginIntent>>} */
async function readAll() {
  try {
    const stored = (await chrome.storage.session.get(KEY))[KEY] ?? {};
    const fresh = {};
    const now = Date.now();
    for (const [tabId, intent] of Object.entries(stored)) {
      if (
        intent &&
        typeof intent.domain === 'string' &&
        typeof intent.at === 'number' &&
        now - intent.at < MAX_AGE_MS
      ) {
        fresh[tabId] = intent;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

/** @param {Record<string, LoginIntent>} all */
async function writeAll(all) {
  try {
    if (Object.keys(all).length) await chrome.storage.session.set({ [KEY]: all });
    else await chrome.storage.session.remove(KEY);
  } catch {
    // Losing an intent means automatic confirmation may be missed; the login still opens.
  }
}

/**
 * @param {number} tabId
 * @param {string} domain
 */
export async function rememberLoginIntent(tabId, domain) {
  const all = await readAll();
  all[String(tabId)] = { domain, attemptedEntry: false, at: Date.now() };
  await writeAll(all);
}

/** @param {number} tabId @returns {Promise<LoginIntent | null>} */
export async function getLoginIntent(tabId) {
  return (await readAll())[String(tabId)] ?? null;
}

/** @param {number} tabId */
export async function markLoginEntryAttempted(tabId) {
  const all = await readAll();
  const intent = all[String(tabId)];
  if (!intent) return;
  all[String(tabId)] = { ...intent, attemptedEntry: true, at: Date.now() };
  await writeAll(all);
}

/** @param {number} tabId */
export async function clearLoginIntent(tabId) {
  const all = await readAll();
  delete all[String(tabId)];
  await writeAll(all);
}

/** @param {string} domain @returns {Promise<number[]>} */
export async function loginIntentTabsForDomain(domain) {
  return Object.entries(await readAll())
    .filter(([, intent]) => intent.domain === domain)
    .map(([tabId]) => Number(tabId))
    .filter(Number.isInteger);
}

/** @returns {Promise<number[]>} */
export async function loginIntentTabIds() {
  return Object.keys(await readAll())
    .map(Number)
    .filter(Number.isInteger);
}
