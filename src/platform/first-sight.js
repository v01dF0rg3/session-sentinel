/**
 * What each domain already had, the first time it was seen.
 *
 * WHY NOT ASK THE SITE. (Measured, 1 September 2026.)
 *
 * The previous release asked each site what cookies it hands a stranger, and subtracted
 * that from the user's jar. The idea is sound — bloomberg.com gives anonymous visitors
 * `_session_id_backup`, httpOnly and Secure, so a session cookie proves nothing on its
 * own — but the implementation could never have worked.
 *
 * `Set-Cookie` is a forbidden response header, and Chrome strips it from the Headers object
 * outright. Not filtered by CORS — removed. A same-origin fetch of a response carrying two
 * `Set-Cookie` lines returns:
 *
 *     response.type                    'basic'
 *     response.headers.getSetCookie()  []
 *
 * Response type `basic` is the unfiltered case, so there is no context — page or extension,
 * same origin or host-permitted — where this returns anything. Reading those headers needs
 * `chrome.webRequest` with `extraHeaders`, which is a permission to observe all network
 * traffic. That is a large thing for a privacy tool to take in exchange for tidying a list.
 *
 * WHAT IS LEFT, AND WHY IT IS ENOUGH.
 *
 * An anonymous session cookie is issued on first contact and then sits there. An
 * authenticated one appears at the moment of signing in. So the first time a domain is
 * scanned, whatever it already has is recorded and treated as proving nothing — it predates
 * anything this extension could have watched. A cookie that shows up *later* is the
 * interesting one, and that needs no permission at all.
 *
 * The gap is a site the user was already signed into before installing: their auth cookie
 * goes into the baseline with everything else. Nothing local can distinguish that, so it is
 * not guessed at — the user is asked, once, in platform/site-verdict.js. They are the only
 * one who actually knows.
 */

const SIGHT_KEY = 'firstSight';

/**
 * Record what each domain already had. Never overwritten: the whole value is that it
 * describes the world before we were watching.
 *
 * Which domains were new matters as much as the record. Judging a domain against a baseline
 * written microseconds earlier in the same pass rules out every cookie it has, so every site
 * grades anonymous, nothing is shown, and nothing is even left marked unknown. A baseline is
 * evidence from the scan *after* the one that captured it.
 *
 * @param {{ domain: string, authNames: string[] }[]} sites
 * @returns {Promise<{ sight: Record<string, string[]>, added: Set<string> }>}
 */
export async function recordFirstSight(sites) {
  try {
    const stored = await chrome.storage.local.get(SIGHT_KEY);
    /** @type {Record<string, string[]>} */
    const sight = stored[SIGHT_KEY] ?? {};
    /** @type {Set<string>} */
    const added = new Set();

    for (const site of sites) {
      if (sight[site.domain] !== undefined) continue;
      sight[site.domain] = site.authNames;
      added.add(site.domain);
    }

    if (added.size) await chrome.storage.local.set({ [SIGHT_KEY]: sight });
    return { sight, added };
  } catch {
    return { sight: {}, added: new Set() };
  }
}

export async function clearFirstSight() {
  try {
    await chrome.storage.local.remove([SIGHT_KEY, 'anonBaselines']);
  } catch {
    // Ignore.
  }
}
