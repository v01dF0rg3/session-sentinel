/**
 * Crash breadcrumbs.
 *
 * Something in the logout path is ending the browser session, and it has survived two
 * rounds of reasoning about which call is responsible. Reasoning has had its turn; this
 * records where the run actually was when the lights went out.
 *
 * A breadcrumb is written to `chrome.storage.local` immediately BEFORE each risky
 * operation and cleared once the run finishes normally. Storage survives the browser
 * dying, so if a breadcrumb is still there at the next startup, it names the exact call
 * that was in flight — including the site it was working on.
 *
 * Deliberately not `storage.session`: that is wiped when the browser closes, which is
 * precisely the event being investigated.
 */

const KEY = 'crashTrail';

/**
 * @typedef {object} Breadcrumb
 * @property {string} step Machine-readable step id.
 * @property {string} description What was about to happen, in plain words.
 * @property {string} domain
 * @property {number} at
 */

/**
 * Record what is about to be attempted. Awaited so the write lands before the call that
 * might not return.
 *
 * @param {string} step
 * @param {string} description
 * @param {string} domain
 */
export async function mark(step, description, domain = '') {
  try {
    await chrome.storage.local.set({
      [KEY]: { step, description, domain, at: Date.now() }
    });
  } catch {
    // Diagnostics must never be the thing that breaks a run.
  }
}

/** Clear the trail after a run completes normally. */
export async function clearTrail() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}

/**
 * A breadcrumb left behind by a run that never finished.
 * @returns {Promise<Breadcrumb | null>}
 */
export async function readTrail() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return stored[KEY] ?? null;
  } catch {
    return null;
  }
}
