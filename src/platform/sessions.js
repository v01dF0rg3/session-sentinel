/**
 * Reading and destroying local session material.
 *
 * Division of labour, deliberately:
 *   chrome.cookies      - enumeration and verification. It can read names and flags,
 *                         which is how we know a site looks logged in.
 *   chrome.browsingData - destruction. It clears partitioned (CHIPS) cookies and
 *                         every storage backend in one call, which hand-rolled
 *                         cookies.remove() loops silently miss.
 */

import { normalizeCookieDomain, registrableDomain } from '../core/domain.js';
import { looksLikeSessionCookie, sessionEvidence } from '../core/risk.js';

/**
 * @typedef {object} SiteSession
 * @property {string} domain Registrable domain.
 * @property {number} cookieCount
 * @property {number} sessionCookieCount Cookies that look auth-bearing.
 * @property {number} strongCount Cookies that look like real auth tokens.
 * @property {number} moderateCount
 * @property {boolean} signedIn Confident the user has an account here.
 * @property {boolean} hasHostOnlySecure
 * @property {number} lastAccessHint Best-effort recency for sorting.
 */

/**
 * Every registrable domain with cookies in the jar, with a rough "are you logged in"
 * signal. This is what makes the extension zero-config: the target list is derived
 * from the browser, not typed in by the user.
 * @returns {Promise<SiteSession[]>}
 */
export async function discoverSessions() {
  const cookies = await chrome.cookies.getAll({});
  /** @type {Map<string, SiteSession>} */
  const sites = new Map();

  for (const cookie of cookies) {
    const host = normalizeCookieDomain(cookie.domain);
    const domain = registrableDomain(host);
    if (!domain || domain === 'localhost') continue;

    let entry = sites.get(domain);
    if (!entry) {
      entry = {
        domain,
        cookieCount: 0,
        sessionCookieCount: 0,
        strongCount: 0,
        moderateCount: 0,
        signedIn: false,
        hasHostOnlySecure: false,
        lastAccessHint: 0
      };
      sites.set(domain, entry);
    }

    entry.cookieCount += 1;
    if (looksLikeSessionCookie(cookie.name)) entry.sessionCookieCount += 1;

    // Graded separately from the generous count above. That one decides what to destroy
    // and errs towards yes; this one decides what to put on screen and must not.
    const evidence = sessionEvidence(cookie);
    if (evidence === 'strong') entry.strongCount += 1;
    else if (evidence === 'moderate') entry.moderateCount += 1;
    if (cookie.secure && cookie.httpOnly) entry.hasHostOnlySecure = true;
    // Session cookies (no expiry) are a strong signal of an active login.
    if (cookie.expirationDate === undefined) entry.sessionCookieCount += 1;
    if (cookie.expirationDate && cookie.expirationDate > entry.lastAccessHint) {
      entry.lastAccessHint = cookie.expirationDate;
    }
  }

  // One unmistakable auth cookie, or two near-misses. Anything less is a site that set a
  // cookie while the user read a page, not one they have an account on.
  for (const entry of sites.values()) {
    entry.signedIn = entry.strongCount > 0 || entry.moderateCount >= 2;
  }

  return [...sites.values()];
}

/**
 * Sites that look genuinely authenticated, rather than merely cookied by an ad tag.
 * @param {SiteSession[]} sessions
 * @returns {SiteSession[]}
 */
export function likelyLoggedIn(sessions) {
  return sessions.filter((s) => s.sessionCookieCount > 0 || (s.hasHostOnlySecure && s.cookieCount >= 2));
}

/**
 * @typedef {object} WipeResult
 * @property {boolean} ok True only if cookies were removed - the one type that must work.
 * @property {string[]} cleared Data types actually removed.
 * @property {string[]} failed Data types that could not be removed.
 * @property {string} [error]
 */

/**
 * Destroy local session material for one site.
 *
 * `chrome.browsingData` keys cookie removal by registrable domain, so this covers
 * subdomains and partitioned cookies. Storage types are keyed by exact origin, hence
 * both http and https variants.
 *
 * A single `remove()` call with several data types is all-or-nothing: if Chrome rejects
 * one type, none of them are cleared. The earlier version caught that, deleted cookies
 * as a fallback, and returned ok - so a "deep" wipe could quietly degrade to cookies
 * only while still reporting success. Now a failure is retried type by type and the
 * result names exactly what survived.
 *
 * @param {string} domain Registrable domain.
 * @param {string[]} dataTypes chrome.browsingData keys.
 * @returns {Promise<WipeResult>}
 */
export async function wipeSite(domain, dataTypes) {
  const origins = [`https://${domain}`, `http://${domain}`, `https://www.${domain}`];
  const scope = { origins, originTypes: { unprotectedWeb: true } };

  /** @type {Record<string, boolean>} */
  const removal = {};
  for (const type of dataTypes) removal[type] = true;

  try {
    await chrome.browsingData.remove(scope, removal);
    return { ok: true, cleared: [...dataTypes], failed: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Find out precisely which types this Chrome will not clear for an origin, rather
    // than assuming the whole call is unsupported.
    /** @type {string[]} */
    const cleared = [];
    /** @type {string[]} */
    const failed = [];
    for (const type of dataTypes) {
      try {
        await chrome.browsingData.remove(scope, { [type]: true });
        cleared.push(type);
      } catch {
        failed.push(type);
      }
    }

    // Cookies are the session. If the API would not remove them, delete them by hand
    // rather than escalating to a browser-wide wipe - clearing every site's data
    // because one call failed is not an acceptable failure mode for a security tool.
    if (failed.includes('cookies')) {
      const fallback = await removeCookiesForDomain(domain);
      if (fallback.ok) {
        failed.splice(failed.indexOf('cookies'), 1);
        cleared.push('cookies');
      }
    }

    return {
      ok: cleared.includes('cookies'),
      cleared,
      failed,
      error: failed.length ? `could not clear ${failed.join(', ')} (${message})` : undefined
    };
  }
}

/**
 * Explicit cookie removal across every cookie store (covers incognito when the
 * extension is allowed there).
 * @param {string} domain
 * @returns {Promise<{ ok: boolean, removed: number }>}
 */
export async function removeCookiesForDomain(domain) {
  let removed = 0;
  try {
    const stores = await chrome.cookies.getAllCookieStores();
    for (const store of stores) {
      const cookies = await chrome.cookies.getAll({ domain, storeId: store.id });
      for (const cookie of cookies) {
        const host = normalizeCookieDomain(cookie.domain);
        const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`;
        try {
          await chrome.cookies.remove({
            url,
            name: cookie.name,
            storeId: store.id,
            ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {})
          });
          removed += 1;
        } catch {
          // A single stubborn cookie must not abort the sweep.
        }
      }
    }
    return { ok: true, removed };
  } catch {
    return { ok: false, removed };
  }
}

/**
 * Confirm a wipe actually landed. A security tool that reports success without
 * checking is worse than one that reports failure honestly.
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
export async function verifyCleared(domain) {
  try {
    const remaining = await chrome.cookies.getAll({ domain });
    return remaining.filter((c) => looksLikeSessionCookie(c.name)).length === 0;
  } catch {
    return false;
  }
}
