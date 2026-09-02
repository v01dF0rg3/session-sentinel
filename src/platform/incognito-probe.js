/**
 * Measure what a site gives a visitor with no account, using Chrome's separate
 * in-memory Incognito cookie store.
 *
 * This is deliberately an explicit diagnostics experiment, not an automatic scan:
 * loading a site contacts it, and a private store is only an anonymous yardstick when
 * it is genuinely empty. The caller must start with a blank Incognito window and the
 * probe refuses to run if it sees any private cookies or web pages.
 *
 * Chrome supplies cookie values and the existing classifier uses their length, but this
 * module never returns, stores, displays or transmits them. Only names and counts leave
 * the probe.
 */

import { hostnameFromUrl, normalizeCookieDomain, registrableDomain } from '../core/domain.js';
import { sessionEvidence } from '../core/risk.js';
import { closeTab, sleep } from './tabs.js';

const BLANK_PRIVATE_URL = /^(?:about:blank|chrome:\/\/(?:newtab|new-tab-page)\/?)/i;

/**
 * @typedef {object} CookieStoreLike
 * @property {string} id
 * @property {number[]} tabIds
 */

/**
 * @typedef {object} WindowLike
 * @property {number} [id]
 * @property {boolean} incognito
 * @property {Array<{ id?: number, url?: string, pendingUrl?: string }>} [tabs]
 */

/**
 * Turn either a domain or an http(s) URL into one registrable domain.
 * @param {string} input
 * @returns {string}
 */
export function normalizeProbeDomain(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) throw new Error('enter a domain first');

  let host;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('not http');
    host = parsed.hostname;
  } catch {
    throw new Error('enter a valid website domain, such as bloomberg.com');
  }

  const domain = registrableDomain(host);
  if (!domain || domain === 'localhost' || domain.includes(':') || /^\d+(?:\.\d+){3}$/.test(domain)) {
    throw new Error('the private probe needs a public website domain');
  }
  return domain;
}

/**
 * The cookie store whose tabs belong to Incognito windows.
 *
 * Kept pure so the store-association rule is testable without Chrome. Cookie-store IDs
 * are opaque; assuming that "1" means Incognito would be another browser behaviour
 * guessed rather than measured.
 *
 * @param {WindowLike[]} windows
 * @param {CookieStoreLike[]} stores
 * @returns {CookieStoreLike | null}
 */
export function selectIncognitoStore(windows, stores) {
  const privateTabIds = new Set(
    windows
      .filter((window) => window.incognito)
      .flatMap((window) => window.tabs ?? [])
      .map((tab) => tab.id)
      .filter((id) => id !== undefined)
  );

  const matches = stores.filter((store) => store.tabIds.some((tabId) => privateTabIds.has(tabId)));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Reduce cookies to the names that participate in the display candidate test.
 * A name that appears in both grades is reported once, at its strongest grade.
 *
 * @param {Array<{ name: string, value?: string, httpOnly?: boolean, secure?: boolean }>} cookies
 * @returns {{ strong: string[], moderate: string[], authNames: string[] }}
 */
export function authCookieNames(cookies) {
  const strong = new Set();
  const moderate = new Set();

  for (const cookie of cookies) {
    const evidence = sessionEvidence(cookie);
    if (evidence === 'strong') {
      strong.add(cookie.name);
      moderate.delete(cookie.name);
    } else if (evidence === 'moderate' && !strong.has(cookie.name)) {
      moderate.add(cookie.name);
    }
  }

  const strongNames = [...strong].sort();
  const moderateNames = [...moderate].sort();
  return {
    strong: strongNames,
    moderate: moderateNames,
    authNames: [...strongNames, ...moderateNames].sort()
  };
}

/** @param {{ url?: string, pendingUrl?: string }} tab */
function isBlankPrivateTab(tab) {
  const url = tab.pendingUrl || tab.url || '';
  return !url || BLANK_PRIVATE_URL.test(url);
}

/**
 * Wait for a real top-level document and prove that script injection reaches it. A tab
 * reporting "complete" on Chrome's network error page is not a successful measurement.
 *
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<string>} final document URL
 */
async function waitForDocument(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      await sleep(800);
      try {
        const [frame] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({ url: location.href, readyState: document.readyState })
        });
        if (frame?.result?.readyState === 'complete' && frame.result.url) return frame.result.url;
      } catch {
        throw new Error('the private page could not be inspected (it may have failed to load)');
      }
    }
    await sleep(200);
  }
  throw new Error('the private page did not finish loading in time');
}

/**
 * Load one domain in a pre-existing, empty Incognito window and return the anonymous
 * cookie-name measurement. The probe tab is closed, but other private site data remains
 * memory-only until the user closes every Incognito window.
 *
 * @param {string} input
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   domain: string,
 *   finalDomain: string,
 *   storeId: string,
 *   totalCookieCount: number,
 *   siteCookieCount: number,
 *   strong: string[],
 *   moderate: string[],
 *   authNames: string[]
 * }>}
 */
export async function probeAnonymousCookies(input, options = {}) {
  const domain = normalizeProbeDomain(input);
  const timeoutMs = options.timeoutMs ?? 20000;
  // Without this check the failure is a dead end. Incognito access is off by default, and
  // while it is off Chrome hides private windows from the extension entirely - so the
  // probe reports "open an Incognito window", the user opens one, and gets the identical
  // message with nothing to suggest the real obstacle is a checkbox on another page.
  let allowed = false;
  try {
    allowed = await chrome.extension.isAllowedIncognitoAccess();
  } catch {
    allowed = false;
  }
  if (!allowed) {
    throw new Error(
      'this experiment needs Incognito access: open chrome://extensions, click Details on Session Sentinel, and turn on "Allow in Incognito"'
    );
  }

  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const privateWindows = windows.filter((window) => window.incognito && window.id !== undefined);
  if (!privateWindows.length) {
    throw new Error('open one fresh blank Incognito window and try again');
  }

  const nonBlank = privateWindows.flatMap((window) => window.tabs ?? []).filter((tab) => !isBlankPrivateTab(tab));
  if (nonBlank.length) {
    throw new Error('the Incognito window is not blank; close every Incognito window, then open one new blank window');
  }

  const stores = await chrome.cookies.getAllCookieStores();
  const store = selectIncognitoStore(windows, stores);
  if (!store) {
    throw new Error('Chrome did not expose one unambiguous Incognito cookie store');
  }

  // This is the key validity check. A private jar that has been used may contain a real
  // login and cannot stand in for a stranger, even if the target domain itself is empty.
  const before = await chrome.cookies.getAll({ storeId: store.id });
  if (before.length) {
    throw new Error('the Incognito cookie store is not empty; close every Incognito window, then open one new blank window');
  }

  const windowId = privateWindows[0].id;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({
      windowId,
      url: `https://${domain}/`,
      active: false
    });
    if (!tab.id || !tab.incognito) throw new Error('Chrome did not create the probe tab in Incognito');
    tabId = tab.id;

    const finalUrl = await waitForDocument(tabId, timeoutMs);
    const finalHost = hostnameFromUrl(finalUrl);
    const finalDomain = finalHost ? registrableDomain(finalHost) : '';
    if (finalDomain !== domain) {
      throw new Error(`the site redirected to ${finalDomain || 'a non-web page'}; that is not a clean ${domain} baseline`);
    }

    const allPrivateCookies = await chrome.cookies.getAll({ storeId: store.id });
    const siteCookies = allPrivateCookies.filter(
      (cookie) => registrableDomain(normalizeCookieDomain(cookie.domain)) === domain
    );
    const names = authCookieNames(siteCookies);

    return {
      domain,
      finalDomain,
      storeId: store.id,
      totalCookieCount: allPrivateCookies.length,
      siteCookieCount: siteCookies.length,
      ...names
    };
  } finally {
    if (tabId !== null) await closeTab(tabId);
  }
}
