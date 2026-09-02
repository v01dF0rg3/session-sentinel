/**
 * Finding a site's password page without anyone hand-writing it down.
 *
 * THE PROBLEM THIS SOLVES.
 *
 * The extension cannot compel or independently verify a site's session revocation. It may
 * only operate controls available to a person at the keyboard, and "end every session" is
 * a button many sites do not have. Every mechanism that could change that — Shared Signals, RISC, CAEP,
 * device-bound credentials — is either server-to-server or lives in the browser itself.
 * There is no protocol by which a site grants an extension that power, and inventing one
 * would mean shipping a spec no site implements.
 *
 * What is true, and is the reason this file exists: after reviewing active sessions, a user
 * may also need the site's real password settings when credentials could be exposed.
 * Providers differ on whether a password change invalidates existing sessions, so finding
 * the page is useful navigation—not proof of revocation.
 *
 * Until now that answer came from a hand-written table of two dozen domains. Everything
 * outside it got "check its account security settings", which is advice-shaped but not
 * actually advice.
 *
 * THE STANDARD.
 *
 * `/.well-known/change-password` is a real, deployed W3C convention: a site serves or
 * redirects it to wherever a password is changed. Password managers already use it. It
 * needs no cooperation beyond what sites have already shipped, and it needs no curation
 * from us — which turns twenty-three domains into most of the web.
 *
 * We hand the user the well-known URL itself rather than resolving it, deliberately. The
 * redirect is then followed by their own browser, carrying their own cookies, landing them
 * on the signed-in page. Resolving it here — from a service worker, with credentials
 * omitted — would follow the logged-out branch and hand them a login screen instead.
 *
 * DETECTING SUPPORT, AND WHY THE SECOND PROBE.
 *
 * A site that has never heard of the convention should 404. Plenty instead answer 200 with
 * a soft error page, and opening one of those is the Proton bug again: a tab full of
 * nothing, at the exact moment the user is frightened. So the spec's own recommendation is
 * followed — ask for a URL that cannot possibly exist first. If *that* comes back 200, the
 * site's status codes carry no information and its well-known answer proves nothing.
 *
 * Pure - no chrome.* and no fetch here. This decides; platform/ does the asking.
 */

export const WELL_KNOWN_PATH = '/.well-known/change-password';

/**
 * The control probe. Its only job is to be absent; the name is verbose because the spec
 * makes it verbose, so that no site could plausibly have one.
 */
export const CONTROL_PATH =
  '/.well-known/resource-that-should-not-exist-whose-status-code-should-not-be-200';

/**
 * @param {string} domain Registrable domain.
 * @returns {string}
 */
export function changePasswordUrl(domain) {
  return `https://${domain}${WELL_KNOWN_PATH}`;
}

/** @param {string} domain */
export function controlUrl(domain) {
  return `https://${domain}${CONTROL_PATH}`;
}

/**
 * Hosts worth asking, in order.
 *
 * Measured, not guessed: google.com answers 404 for the well-known URL while
 * accounts.google.com serves it, because the identity system lives on the subdomain and
 * the marketing site does not know about it. Stopping at the apex would have written
 * Google off. `www.` is included because a few sites only answer there.
 *
 * The list is deliberately short. Each candidate costs two requests, and a recovery plan
 * covering twenty accounts multiplies whatever this returns.
 *
 * @param {string} domain Registrable domain.
 * @returns {string[]}
 */
export function hostCandidates(domain) {
  return [domain, `accounts.${domain}`, `www.${domain}`];
}

/**
 * @typedef {object} ProbeResult
 * @property {boolean} supported Safe to send the user to the well-known URL.
 * @property {'ok' | 'absent' | 'unreliable' | 'unreachable'} reason
 * @property {string} [url] The exact URL to open, present only when supported.
 */

/**
 * Read two status codes into an answer.
 *
 * Absence is judged the same way the logout-path probe judges it: only an explicit 404 or
 * 410 means "not here". A 401, a 403 or a redirect to a login wall all mean the endpoint
 * exists and the site simply wants the user signed in first — which is exactly what will
 * happen when they click it, in a browser that has their cookies.
 *
 * @param {number | null} controlStatus Null when the request could not be made.
 * @param {number | null} wellKnownStatus
 * @returns {ProbeResult}
 */
export function interpretProbe(controlStatus, wellKnownStatus) {
  if (controlStatus === null || wellKnownStatus === null) {
    return { supported: false, reason: 'unreachable' };
  }

  // The site answers 200 for a URL that cannot exist, so its 200 for the real one means
  // nothing either. Better to say we do not know than to open a soft 404.
  if (controlStatus === 200) return { supported: false, reason: 'unreliable' };

  if (wellKnownStatus === 404 || wellKnownStatus === 410) {
    return { supported: false, reason: 'absent' };
  }

  return { supported: true, reason: 'ok' };
}
