/**
 * Persistent record of what worked, per site.
 *
 * A tally rather than a scan of the activity log: the log is capped at 200 entries and
 * rotates away, whereas the question "does the fallback work on this site" is answered by
 * the most recent result and should survive indefinitely.
 *
 * Stores a domain, an outcome, and which tier did the work. No URLs, no timestamps of
 * visits, nothing about what the user did on the site — this is a record of the
 * extension's own behaviour, not of browsing.
 */

const KEY = 'coverage';
const MAX_ENTRIES = 500;

/** @typedef {import('../core/coverage.js').CoverageEntry} CoverageEntry */

/**
 * @param {string} domain
 * @param {CoverageEntry['outcome']} outcome
 * @param {import('../engine/logout.js').LogoutMethod} method
 * @param {boolean} attempted
 * @param {'attempted' | 'notAttempted'} [serverAction]
 */
export async function recordOutcome(domain, outcome, method, attempted, serverAction) {
  try {
    const stored = await chrome.storage.local.get(KEY);
    /** @type {Record<string, CoverageEntry>} */
    const all = stored[KEY] ?? {};
    const previous = all[domain];

    all[domain] = {
      domain,
      outcome,
      method,
      attempted,
      ...(serverAction ? { serverAction } : {}),
      at: Date.now(),
      runs: (previous?.runs ?? 0) + 1
    };

    // Bounded, oldest first. A profile with hundreds of sites should not accumulate an
    // unbounded record of them.
    const entries = Object.values(all);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b.at - a.at);
      const trimmed = {};
      for (const entry of entries.slice(0, MAX_ENTRIES)) trimmed[entry.domain] = entry;
      await chrome.storage.local.set({ [KEY]: trimmed });
      return;
    }

    await chrome.storage.local.set({ [KEY]: all });
  } catch {
    // Measurement must never break a run.
  }
}

/** @returns {Promise<CoverageEntry[]>} */
export async function readCoverage() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return Object.values(stored[KEY] ?? {});
  } catch {
    return [];
  }
}

export async function clearCoverage() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}
