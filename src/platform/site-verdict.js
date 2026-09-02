/**
 * Persistent user overrides for candidate sites.
 *
 * Four rules in a row tried to infer this from cookies and each was wrong in a new way,
 * because the thing being inferred is not in the cookies. bloomberg.com hands anonymous
 * visitors a cookie that is httpOnly, Secure, opaque and named `_session_id_backup`; there
 * is no signal that separates it from an authenticated one. The header that would settle it
 * is stripped by Chrome. An empty-Incognito measurement proves the name is ambiguous, but
 * not whether a normal session with that same name was upgraded by sign-in.
 *
 * "Not mine" is the current escape hatch: when the user says they do not have an account,
 * that answer is respected permanently. The old candidate UI also stored "mine" when its
 * Add button was used. That value is retained for existing installations and still counts
 * as confirmation, but new candidates now go through the live Login verification flow.
 *
 * These controls are only shown for sites the automatic rules could not settle. A site
 * whose auth cookie appeared after we started watching does not need an override.
 */

const KEY = 'siteVerdicts';

/** @typedef {'mine' | 'notMine'} SiteVerdict */

/** @returns {Promise<Record<string, SiteVerdict>>} */
export async function getVerdicts() {
  try {
    return (await chrome.storage.local.get(KEY))[KEY] ?? {};
  } catch {
    return {};
  }
}

/**
 * @param {string} domain
 * @param {SiteVerdict | null} verdict Null forgets the answer.
 */
export async function setVerdict(domain, verdict) {
  try {
    const all = await getVerdicts();
    if (verdict) all[domain] = verdict;
    else delete all[domain];
    await chrome.storage.local.set({ [KEY]: all });
    return all;
  } catch {
    return {};
  }
}

export async function clearVerdicts() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}
