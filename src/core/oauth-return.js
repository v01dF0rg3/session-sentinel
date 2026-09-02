/**
 * Spotting the moment a federated sign-in completes.
 *
 * WHY THIS EXISTS, PRECISELY.
 *
 * A sign-in is normally detected as a cookie name that was not in the site's page-load
 * baseline. That misses one case, and it is not "SSO" in general — plenty of SSO logins
 * set a brand-new cookie and are caught fine. It is **cookie name reuse**: a site that
 * carries the same cookie name through login, anonymous session and authenticated session
 * alike, changing only the value. Nothing in the name set changes, so nothing is detected.
 * Password logins on such sites are missed identically; federation just makes it common,
 * because the round trip leaves the site's own cookie untouched until the callback.
 *
 * The value does change, but values also rotate constantly for anonymous sessions, so
 * "the value changed" is far too noisy to mean anything.
 *
 * WHAT IS UNAMBIGUOUS.
 *
 * The navigation itself. An OAuth callback is a top-level load back onto the site carrying
 * an authorization code, or a return trip from an identity provider's authorize endpoint.
 * Neither happens by accident, and both are visible without reading a single cookie value.
 *
 * THE TRAP.
 *
 * google.com is on the identity-provider list and is also the most-used search engine on
 * earth. "Came from google.com" describes a search result click far more often than a
 * completed login, so the provider's host and path have to look like an auth endpoint —
 * `accounts.google.com`, `login.microsoftonline.com`, `/oauth/authorize` — and never a
 * bare `www.google.com/search`.
 *
 * Pure - no chrome.* here.
 */

import { hostnameFromUrl, registrableDomain } from './domain.js';
import { isIdentityProvider } from './trust.js';

/** Subdomains that exist to host sign-in, rather than a site's ordinary content. */
const AUTH_HOST = /^(accounts?|login|signin|auth|id|sso|oauth|idp)\./i;

/** Paths an authorize step lives at, on providers that use the apex domain. */
const AUTH_PATH = /\/(oauth2?|authorize|signin|sign-in|login|auth|connect|saml|openid)(\/|$)/i;

/**
 * Was this URL an identity provider actively authenticating someone?
 *
 * Deliberately stricter than "is a known provider". The provider list contains google.com,
 * so anything looser would read every search result click as a completed sign-in.
 *
 * @param {string | null | undefined} url
 * @returns {boolean}
 */
export function looksLikeAuthStep(url) {
  if (!url) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  // Reuses the provider allowlist that already gates logout navigation, so there is one
  // list of who counts as an identity provider rather than two that can drift apart.
  const host = parsed.hostname;
  if (!isIdentityProvider(host)) return false;

  return AUTH_HOST.test(host) || AUTH_PATH.test(parsed.pathname);
}

/**
 * Does this URL carry an OAuth authorization response?
 *
 * `code` alone is not enough — sites use it for discount codes, referral codes and
 * tracking. `code` together with `state` is the authorization-code flow and essentially
 * nothing else.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function carriesAuthCode(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  const query = parsed.searchParams;
  if (query.has('code') && query.has('state')) return true;

  // The implicit flow returns its token in the fragment. Largely deprecated, still seen.
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return fragment.has('access_token') || fragment.has('id_token');
}

/**
 * The domain that just completed a federated sign-in, if this navigation was one.
 *
 * @param {string} url The page being loaded.
 * @param {string | null} [previousUrl] The last top-level URL in the same tab.
 * @returns {string | null} Registrable domain, or null.
 */
export function signInCompletedFor(url, previousUrl = null) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const domain = registrableDomain(hostnameFromUrl(url) ?? '');
  if (!domain || domain === 'localhost') return null;

  // A callback carrying an authorization code stands on its own.
  if (carriesAuthCode(url)) return domain;

  // Otherwise the evidence is the round trip: an authenticating provider handed the user
  // back to a different site. Landing back on the provider itself proves nothing, because
  // that is simply the provider's own pages.
  if (!looksLikeAuthStep(previousUrl)) return null;
  const from = registrableDomain(hostnameFromUrl(previousUrl ?? '') ?? '');
  return from && from !== domain ? domain : null;
}
