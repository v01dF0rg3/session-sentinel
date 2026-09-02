/**
 * Asking a site whether it supports /.well-known/change-password, and remembering.
 *
 * Two requests per site, cached indefinitely: a site that ships the convention does not
 * stop, and one that never had it rarely gains it. The cache matters more than it looks —
 * the recovery walkthrough asks about every account at once, and probing a list of twenty
 * domains on every open would be both slow and rude to those sites.
 *
 * Requests go out with credentials omitted. We are asking a yes/no question about a URL's
 * existence and have no business attaching the user's session to it; the actual visit
 * happens later, in a real tab, under the user's own cookies.
 */

import { CONTROL_PATH, WELL_KNOWN_PATH, hostCandidates, interpretProbe } from '../core/change-password.js';

const KEY = 'changePasswordSupport';
const PROBE_TIMEOUT_MS = 6000;

/** @typedef {import('../core/change-password.js').ProbeResult} ProbeResult */

/**
 * Status code for one URL, or null when the request could not be completed at all.
 * A network failure is not a 404 and must not be read as one.
 *
 * @param {string} url
 * @returns {Promise<number | null>}
 */
async function statusOf(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  try {
    // GET rather than HEAD: enough sites answer HEAD with 405 or route it differently that
    // HEAD would produce confident nonsense. Redirects are followed so that a site
    // redirecting the well-known URL to its real password page reads as present.
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      signal: abort.signal,
      cache: 'no-store'
    });
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask one host. Two requests at most, the control first so a soft-404 site short-circuits.
 *
 * @param {string} host
 * @returns {Promise<ProbeResult>}
 */
async function probeHost(host) {
  const control = await statusOf(`https://${host}${CONTROL_PATH}`);
  if (control === 200) return interpretProbe(200, 200);

  const url = `https://${host}${WELL_KNOWN_PATH}`;
  const result = interpretProbe(control, await statusOf(url));
  return result.supported ? { ...result, url } : result;
}

/**
 * Does this site support the change-password convention, and at which host?
 *
 * Candidates are tried in order and the first success wins. A miss at the apex is not the
 * end of it: google.com 404s while accounts.google.com serves the endpoint, and stopping
 * early would have written off one of the most important accounts a person has.
 *
 * @param {string} domain Registrable domain.
 * @param {boolean} [force] Skip the cache.
 * @returns {Promise<ProbeResult>}
 */
export async function probeChangePassword(domain, force = false) {
  try {
    const stored = await chrome.storage.local.get(KEY);
    /** @type {Record<string, ProbeResult>} */
    const cache = stored[KEY] ?? {};
    if (!force && cache[domain]) return cache[domain];

    /** @type {ProbeResult} */
    let result = { supported: false, reason: 'unreachable' };
    /** @type {ProbeResult | null} */
    let firstAnswer = null;

    for (const host of hostCandidates(domain)) {
      result = await probeHost(host);
      if (result.supported) break;
      // The apex is the canonical host, so its verdict is the one worth reporting when no
      // candidate works. Without this, linkedin.com — which soft-404s at the apex and
      // hard-404s at www — would be reported as a plain absence, hiding the fact that we
      // could not get a trustworthy answer out of it at all.
      if (!firstAnswer && result.reason !== 'unreachable') firstAnswer = result;
    }
    if (!result.supported && firstAnswer) result = firstAnswer;

    // 'unreachable' is not a fact about the site, only about the moment - the user may
    // have been offline. Caching it would make a dropped connection permanent.
    if (result.reason !== 'unreachable') {
      cache[domain] = result;
      await chrome.storage.local.set({ [KEY]: cache });
    }
    return result;
  } catch {
    return { supported: false, reason: 'unreachable' };
  }
}

/**
 * What is already known, without asking anyone. Used to render immediately and fill in
 * as answers arrive, rather than making the user wait on a list of network calls.
 *
 * @returns {Promise<Record<string, ProbeResult>>}
 */
export async function knownChangePasswordSupport() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return stored[KEY] ?? {};
  } catch {
    return {};
  }
}

export async function clearChangePasswordCache() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}
