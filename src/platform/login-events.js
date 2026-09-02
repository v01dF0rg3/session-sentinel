/**
 * Sign-ins observed as navigation, for sites whose cookies cannot show one.
 *
 * The usual test is a cookie name that was not in the site's page-load baseline. It misses
 * sites that carry one cookie name through login unchanged, altering only its value —
 * common with federated sign-in, because the round trip leaves the site's own cookie
 * untouched until the callback returns. There the navigation is the only evidence.
 *
 * WHAT IS STORED, AND WHY IT CANNOT GO STALE THE WAY THE OLD CACHE DID.
 *
 * A registrable domain and a timestamp. No URL, no query string — an authorization code is
 * a credential and has no business being written to disk.
 *
 * A previous version cached the verdict "this is an account" and made every mistake
 * permanent. This is deliberately weaker: it records only that a sign-in was *seen*, and
 * the caller still requires the site to hold auth-looking cookies right now before listing
 * it. Clear the cookies and the site drops off, exactly as it should — the record cannot
 * outvote the present.
 */

const KEY = 'loginEvents';
const MAX_ENTRIES = 500;

/**
 * @param {string} domain
 * @returns {Promise<boolean>} Whether this was a new observation.
 */
export async function recordLoginEvent(domain) {
  if (!domain || domain === 'localhost') return false;
  try {
    const stored = await chrome.storage.local.get(KEY);
    /** @type {Record<string, number>} */
    const events = stored[KEY] ?? {};
    const isNew = events[domain] === undefined;
    events[domain] = Date.now();

    // Bounded, oldest evicted first, so a long-lived profile cannot accumulate an
    // unbounded list of the places its owner has signed in.
    const domains = Object.keys(events);
    if (domains.length > MAX_ENTRIES) {
      const keep = domains.sort((a, b) => events[b] - events[a]).slice(0, MAX_ENTRIES);
      const trimmed = {};
      for (const kept of keep) trimmed[kept] = events[kept];
      await chrome.storage.local.set({ [KEY]: trimmed });
      return isNew;
    }

    await chrome.storage.local.set({ [KEY]: events });
    return isNew;
  } catch {
    return false;
  }
}

/** @returns {Promise<Set<string>>} */
export async function observedLogins() {
  try {
    return new Set(Object.keys((await chrome.storage.local.get(KEY))[KEY] ?? {}));
  } catch {
    return new Set();
  }
}

export async function clearLoginEvents() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}
