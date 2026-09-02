/**
 * What a site's own pages said about whether the user is signed in.
 *
 * Kept apart from persistent overrides in site-verdict.js, and always outranked by them.
 * This is an observation the extension made; an override is a statement the user made,
 * and when they disagree the person wins.
 *
 * A later observation replaces an earlier one, because the answer genuinely changes: a
 * site read as anonymous before signing in should not stay that way afterwards. That is
 * the opposite of the cache this project removed, which froze a judgement and had no way
 * to revise it.
 */

const KEY = 'pageVerdicts';
const MAX_ENTRIES = 600;

/** @typedef {'signedIn' | 'anonymous'} PageVerdict */

/**
 * @param {string} domain
 * @param {PageVerdict} verdict
 */
export async function recordPageVerdict(domain, verdict) {
  if (!domain || domain === 'localhost') return;
  try {
    const stored = await chrome.storage.local.get(KEY);
    /** @type {Record<string, { verdict: PageVerdict, at: number }>} */
    const all = stored[KEY] ?? {};
    all[domain] = { verdict, at: Date.now() };

    const domains = Object.keys(all);
    if (domains.length > MAX_ENTRIES) {
      const keep = domains.sort((a, b) => all[b].at - all[a].at).slice(0, MAX_ENTRIES);
      const trimmed = {};
      for (const kept of keep) trimmed[kept] = all[kept];
      await chrome.storage.local.set({ [KEY]: trimmed });
      return;
    }

    await chrome.storage.local.set({ [KEY]: all });
  } catch {
    // An observation lost leaves the site as a candidate for the Login verification flow.
  }
}

/** @returns {Promise<Record<string, PageVerdict>>} */
export async function getPageVerdicts() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    /** @type {Record<string, PageVerdict>} */
    const flat = {};
    for (const [domain, entry] of Object.entries(stored[KEY] ?? {})) flat[domain] = entry.verdict;
    return flat;
  } catch {
    return {};
  }
}

export async function clearPageVerdicts() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}
