/**
 * Two ways of learning which of a site's cookies belong to nobody.
 *
 * FIRST SIGHT (local, always works).
 *
 * The first time a domain is scanned, whatever session-looking cookies it already has are
 * recorded as its baseline. They existed before this extension could have watched a
 * sign-in, so they prove nothing — and they are exactly the cookies that fooled three
 * previous rules. A cookie appearing later that is not in that set is the interesting one.
 *
 * ASKING THE SITE (network, best effort).
 *
 * First sight cannot help with a site the user was already signed into when the extension
 * was installed: their auth cookie goes into the baseline along with everything else. So
 * the site is also asked directly, with no cookies attached, what it hands a stranger.
 * bloomberg.com answers `_session_id_backup` and friends; github.com answers `_gh_sess`,
 * `_octo`, `logged_in` and notably not `user_session`.
 *
 * This may not work. `Set-Cookie` is a forbidden response header, and whether Chrome
 * exposes it to an extension's fetch through `getSetCookie()` is a question about a real
 * browser, not one to be settled by reasoning. So the probe reports whether it actually
 * learned anything, `usable` is false when it did not, and a baseline that learned nothing
 * confirms nothing. Diagnostics reports which of the two is doing the work.
 *
 * Requests carry no credentials. The point is to see the site as a stranger does, and
 * attaching the user's session would defeat that as well as being rude.
 */

import { baselineFrom } from '../core/anon-baseline.js';

const PROBE_KEY = 'anonBaselines';
const SIGHT_KEY = 'firstSight';
const PROBE_TIMEOUT_MS = 6000;

/** @typedef {import('../core/anon-baseline.js').Baseline} Baseline */

/**
 * Cookie names a stranger receives from this site.
 *
 * @param {string} domain
 * @returns {Promise<Baseline>}
 */
async function askSite(domain) {
  /** @type {Set<string>} */
  const names = new Set();

  for (const host of [domain, `www.${domain}`]) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`https://${host}/`, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        signal: abort.signal,
        cache: 'no-store'
      });

      // getSetCookie() is the only accessor that returns every Set-Cookie separately, and
      // it may return nothing at all here. That is a fact to report, not to paper over.
      const raw = response.headers.getSetCookie?.() ?? [];
      for (const line of raw) {
        const name = line.split('=')[0]?.trim();
        if (name) names.add(name);
      }
      if (names.size) break;
    } catch {
      // Try the next host, then give up.
    } finally {
      clearTimeout(timer);
    }
  }

  return baselineFrom(names);
}

/**
 * @param {string} domain
 * @returns {Promise<Baseline>}
 */
export async function anonBaseline(domain) {
  try {
    const stored = await chrome.storage.local.get(PROBE_KEY);
    /** @type {Record<string, Baseline>} */
    const cache = stored[PROBE_KEY] ?? {};
    if (cache[domain]) return cache[domain];

    const baseline = await askSite(domain);

    // Only a result that learned something is worth keeping. Caching "I got nothing" would
    // freeze a network hiccup into a permanent verdict, which is the mistake that made the
    // last one immortal.
    if (baseline.usable) {
      cache[domain] = baseline;
      await chrome.storage.local.set({ [PROBE_KEY]: cache });
    }
    return baseline;
  } catch {
    return baselineFrom([]);
  }
}

/** @returns {Promise<Record<string, Baseline>>} */
export async function knownBaselines() {
  try {
    return (await chrome.storage.local.get(PROBE_KEY))[PROBE_KEY] ?? {};
  } catch {
    return {};
  }
}

/**
 * Record what each domain already had, the first time it is seen. Never overwritten: the
 * whole value is that it describes the world before we were watching.
 *
 * @param {{ domain: string, authGradeNames: string[] }[]} sites
 * @returns {Promise<Record<string, string[]>>} The full record, after any additions.
 */
export async function recordFirstSight(sites) {
  try {
    const stored = await chrome.storage.local.get(SIGHT_KEY);
    /** @type {Record<string, string[]>} */
    const sight = stored[SIGHT_KEY] ?? {};
    let dirty = false;

    for (const site of sites) {
      if (sight[site.domain] !== undefined) continue;
      sight[site.domain] = site.authGradeNames;
      dirty = true;
    }

    if (dirty) await chrome.storage.local.set({ [SIGHT_KEY]: sight });
    return sight;
  } catch {
    return {};
  }
}

export async function clearBaselines() {
  try {
    await chrome.storage.local.remove([PROBE_KEY, SIGHT_KEY]);
  } catch {
    // Ignore.
  }
}

/**
 * Does asking sites work in this browser at all?
 *
 * `Set-Cookie` is a forbidden response header. Whether Chrome exposes it to an extension's
 * fetch through `getSetCookie()` is a fact about a real browser, and three rules have now
 * been wrong because they were reasoned about instead of measured. So this measures it,
 * against a site whose anonymous cookies are known: github.com hands a stranger `_gh_sess`,
 * `_octo` and `logged_in`, and notably not `user_session`.
 *
 * Nothing is cached. This is a question about the browser, asked when someone is looking.
 *
 * @returns {Promise<{ works: boolean, names: string[] }>}
 */
export async function probeSelfTest() {
  const baseline = await askSite('github.com');
  return { works: baseline.usable, names: baseline.anonymous };
}
