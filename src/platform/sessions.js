/**
 * Reading and destroying local session material.
 *
 * Division of labour, deliberately:
 *   chrome.cookies      - enumeration, exact cookie deletion, and readback, including
 *                         partition identities (Chrome 119+).
 *   chrome.browsingData - exact-origin storage deletion. Never used for cookies here:
 *                         its broader domain expansion can differ from our PSL snapshot.
 */

import { isCleanupDomain, normalizeCookieDomain, registrableDomain } from '../core/domain.js';
import { cleanupOrigins, CLEARABLE_TYPES } from '../core/cleanup-scope.js';
import { looksLikeSessionCookie, sessionEvidence } from '../core/risk.js';

/**
 * @typedef {object} SiteSession
 * @property {string} domain Registrable domain.
 * @property {number} cookieCount
 * @property {number} sessionCookieCount Cookies that look auth-bearing.
 * @property {number} strongCount Cookies that look like real auth tokens.
 * @property {number} moderateCount
 * @property {string[]} authNames Names of the cookies that look session-bearing.
 * @property {boolean} signedIn Legacy candidate flag, not confirmed login evidence.
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
        authNames: [],
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
    if (evidence === 'strong' || evidence === 'moderate') entry.authNames.push(cookie.name);
    if (cookie.secure && cookie.httpOnly) entry.hasHostOnlySecure = true;
    // No-expiry cookies widen the safety-wipe candidate set, but do not prove a login.
    if (cookie.expirationDate === undefined) entry.sessionCookieCount += 1;
    if (cookie.expirationDate && cookie.expirationDate > entry.lastAccessHint) {
      entry.lastAccessHint = cookie.expirationDate;
    }
  }

  // One unmistakable auth cookie, or two near-misses. This is a *candidate* test, not a
  // conclusion: bloomberg.com passes it while handing the same cookies to strangers, so
  // whether a candidate is really an account is settled in core/anon-baseline.js against
  // what the site gives someone with no account at all.
  for (const entry of sites.values()) {
    entry.signedIn = entry.strongCount > 0 || entry.moderateCount >= 2;
  }

  return [...sites.values()];
}

/**
 * Broad safety-wipe candidates. This is not the confirmed-account list shown by the UI.
 * @param {SiteSession[]} sessions
 * @returns {SiteSession[]}
 */
export function likelyLoggedIn(sessions) {
  return sessions.filter((s) => s.sessionCookieCount > 0 || (s.hasHostOnlySecure && s.cookieCount >= 2));
}

/**
 * @typedef {object} WipeResult
 * @property {boolean} ok All requested APIs succeeded and cookie readback found none.
 * @property {string[]} cleared Data types whose removal Chrome acknowledged.
 * @property {string[]} failed Data types that could not be removed.
 * @property {number} [originCount] Known origins submitted; not a complete storage inventory.
 * @property {string[]} [warnings]
 * @property {string} [error]
 */

/**
 * Destroy local session material for one site.
 *
 * Cookies are removed by their exact identity in the current store, including partition
 * keys. Storage uses only concrete origins observed before and after the sign-out attempt.
 * A rejected multi-type storage request is retried per type, never widened to all sites.
 *
 * @param {string} domain Registrable domain.
 * @param {string[]} dataTypes chrome.browsingData keys.
 * @param {{ origins: string[], warnings: string[] }} [beforeLogout] Origin hints captured before sign-out can erase cookies.
 * @returns {Promise<WipeResult>}
 */
export async function wipeSite(domain, dataTypes, beforeLogout) {
  if (!isCleanupDomain(domain) || !Array.isArray(dataTypes) || !dataTypes.includes('cookies') ||
      dataTypes.some((type) => !CLEARABLE_TYPES.has(type))) {
    return { ok: false, cleared: [], failed: ['cookies'], error: 'invalid or unsupported cleanup scope' };
  }
  dataTypes = [...new Set(dataTypes)];
  if (!await hasCookieAccess(domain)) {
    return { ok: false, cleared: [], failed: dataTypes, error: 'Site access is unavailable; local cleanup was not attempted.' };
  }
  const current = await snapshotCleanupScope(domain);
  const warnings = [...new Set([...(beforeLogout?.warnings ?? []), ...current.warnings])];
  // Re-validate even caller-supplied hints. They cannot widen the selected site boundary.
  const origins = cleanupOrigins(domain, [], [...(beforeLogout?.origins ?? []), ...current.origins]);
  const scope = { origins, originTypes: { unprotectedWeb: true } };

  /** @type {Record<string, boolean>} */
  const removal = {};
  const storageTypes = dataTypes.filter((type) => type !== 'cookies');
  for (const type of storageTypes) removal[type] = true;

  const cleared = [];
  const failed = [];
  try {
    if (storageTypes.length) await chrome.browsingData.remove(scope, removal);
    cleared.push(...storageTypes);
  } catch {
    // Find out precisely which types this Chrome will not clear for an origin, rather
    // than assuming the whole call is unsupported.
    for (const type of storageTypes) {
      try {
        await chrome.browsingData.remove(scope, { [type]: true });
        cleared.push(type);
      } catch {
        failed.push(type);
      }
    }
  }

  // Cookie removal stays exact even if Chrome's own suffix snapshot differs from ours.
  // Never use browsingData's broader cookie-domain expansion or another cookie store.
  await removeCookiesForDomain(domain);
  const check = await cookieClearance(domain);
  if (check.status === 'cleared') {
    cleared.push('cookies');
  } else {
    failed.push('cookies');
  }
  const scopeIncomplete = storageTypes.length > 0 && warnings.length > 0;
  return {
    ok: failed.length === 0 && !scopeIncomplete,
    cleared,
    failed,
    originCount: origins.length,
    warnings,
    error: failed.length ? `Local cleanup incomplete: ${failed.join(', ')} could not be cleared or verified.`
      : scopeIncomplete ? 'Local cleanup incomplete: some origin evidence was unavailable.' : undefined
  };
}

/** Origin strings only; no cookie values, paths, account labels, or tab IDs are retained. */
export async function snapshotCleanupScope(domain) {
  const warnings = [];
  let cookies = [];
  let tabs = [];
  if (!isCleanupDomain(domain)) return { origins: [], warnings: ['Invalid site boundary.'] };
  try { cookies = await cookiesForDomain(domain); }
  catch { warnings.push('Cookie origins could not be enumerated.'); }
  try {
    tabs = (await chrome.tabs.query({})).filter((tab) =>
      Boolean(tab.incognito) === Boolean(chrome.extension?.inIncognitoContext));
  } catch { warnings.push('Open-tab origins could not be enumerated.'); }
  return { origins: cleanupOrigins(domain, cookies.map((c) => c.domain), tabs.map((t) => t.url)), warnings };
}

/**
 * Explicit cookie removal in the SAME store as discovery. A normal-profile action
 * must not silently escalate to deleting private-store cookies.
 * @param {string} domain
 * @returns {Promise<{ ok: boolean, removed: number }>}
 */
export async function removeCookiesForDomain(domain) {
  let removed = 0;
  if (!isCleanupDomain(domain)) return { ok: false, removed };
  try {
    const cookies = await cookiesForDomain(domain);
    for (const cookie of cookies) {
      const host = normalizeCookieDomain(cookie.domain);
      const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`;
      try {
        const result = await chrome.cookies.remove({
          url,
          name: cookie.name,
          storeId: cookie.storeId,
          ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {})
        });
        if (result) removed += 1;
      } catch {
        // A single stubborn cookie must not abort the sweep. Readback decides success.
      }
    }
    return { ok: await verifyCleared(domain), removed };
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
  return (await cookieClearance(domain)).status === 'cleared';
}

/** No values or names leave this function; absence is a point-in-time local observation. */
export async function cookieClearance(domain) {
  if (!isCleanupDomain(domain)) return { status: 'unavailable', remainingCount: null };
  try {
    const remaining = await cookiesForDomain(domain);
    return { status: remaining.length ? 'remaining' : 'cleared', remainingCount: remaining.length };
  } catch {
    return { status: 'unavailable', remainingCount: null };
  }
}

async function cookiesForDomain(domain) {
  if (!await hasCookieAccess(domain)) throw new Error('Site access unavailable');
  // An empty partitionKey matches partitioned AND unpartitioned cookies (Chrome 119+).
  // Omitting it only reads unpartitioned cookies. No storeId means the current context.
  return (await chrome.cookies.getAll({ domain, partitionKey: {} })).filter((cookie) =>
    registrableDomain(normalizeCookieDomain(cookie.domain)) === domain);
}

async function hasCookieAccess(domain) {
  const ip = domain.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(domain);
  try {
    return await chrome.permissions.contains({ permissions: ['cookies'], origins: [`*://${ip ? domain : `*.${domain}`}/*`] });
  } catch { return false; }
}

/**
 * Which cookies made each site look signed in.
 *
 * Two rounds of this list being wrong were diagnosed by me reasoning about cookie names
 * from memory — `nonsession` was found that way, and only because eBay happened to be on
 * screen. That does not scale to a profile with hundreds of domains on a machine I cannot
 * see. This turns the next disagreement into evidence: the user can look at exactly which
 * cookie put a site on the list and say "that one is not a login".
 *
 * Names only. A cookie's value is the session token itself and has no business being
 * rendered, copied to a clipboard, or pasted into a bug report.
 *
 * @returns {Promise<{ domain: string, strong: string[], moderate: string[] }[]>}
 */
export async function explainSignedIn() {
  const cookies = await chrome.cookies.getAll({});
  /** @type {Map<string, { domain: string, strong: string[], moderate: string[] }>} */
  const sites = new Map();

  for (const cookie of cookies) {
    const evidence = sessionEvidence(cookie);
    if (evidence !== 'strong' && evidence !== 'moderate') continue;

    const domain = registrableDomain(normalizeCookieDomain(cookie.domain));
    if (!domain || domain === 'localhost') continue;

    let entry = sites.get(domain);
    if (!entry) {
      entry = { domain, strong: [], moderate: [] };
      sites.set(domain, entry);
    }
    entry[evidence].push(cookie.name);
  }

  return [...sites.values()]
    .filter((entry) => entry.strong.length > 0 || entry.moderate.length >= 2)
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
