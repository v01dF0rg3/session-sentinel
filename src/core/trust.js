/**
 * Where the extension is willing to be sent.
 *
 * Two inputs decide navigation targets, and neither is fully under our control:
 *
 *   1. `end_session_endpoint` from a site's OIDC discovery document. That document is
 *      served BY the site being logged out. A hostile or compromised site can name any
 *      URL it likes, and the engine would navigate a background tab there and then click
 *      controls matching "sign out|yes|confirm|continue". That is an attacker-steered
 *      click primitive running with the user's cookies - unacceptable in a security tool.
 *
 *   2. `navigate` steps in recipes. Bundled recipes are trustworthy today, but the
 *      roadmap fetches them remotely; a recipe that can navigate anywhere is a much
 *      more dangerous object than one confined to the site it claims to log out of.
 *
 * So navigation is confined to the target site itself, or to a short list of identity
 * providers that legitimately host other sites' logout endpoints. Anything else is
 * refused and reported as an unavailable sign-out attempt, which is honest: we cannot
 * follow an untrusted redirect merely to reach a logout control.
 *
 * Pure - no chrome.* - so the policy is unit-testable.
 */

import { registrableDomain } from './domain.js';

/**
 * Identity providers that legitimately terminate sessions on behalf of other domains.
 * Kept deliberately short. A provider only belongs here if sending a logged-in user to
 * it, and clicking its confirm button, is safe regardless of which site asked.
 */
const TRUSTED_IDP_DOMAINS = new Set([
  'okta.com',
  'oktapreview.com',
  'auth0.com',
  'onelogin.com',
  'pingidentity.com',
  'pingone.com',
  'microsoftonline.com',
  'microsoft.com',
  'live.com',
  'google.com',
  'accounts.google.com',
  'amazoncognito.com',
  'cloudflareaccess.com',
  'duosecurity.com',
  'jumpcloud.com',
  'miniorange.com',
  'fusionauth.io',
  'keycloak.org'
]);

/**
 * May the engine navigate to `url` while logging out of `targetDomain`?
 *
 * @param {string} url
 * @param {string} targetDomain Registrable domain being logged out of.
 * @returns {boolean}
 */
export function isTrustedLogoutDestination(url, targetDomain) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Plaintext logout would put the session cookie on the wire, and non-http schemes
  // (javascript:, data:, chrome-extension:) have no business here at all.
  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  const registrable = registrableDomain(host);

  if (registrable === targetDomain) return true;
  if (TRUSTED_IDP_DOMAINS.has(registrable) || TRUSTED_IDP_DOMAINS.has(host)) return true;

  return false;
}

/**
 * Why a destination was refused, for logging and for the run report.
 * @param {string} url
 * @param {string} targetDomain
 * @returns {string}
 */
export function describeRefusal(url, targetDomain) {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'logout endpoint was not a valid URL';
  }
  return `refused to follow ${targetDomain}'s logout endpoint to ${host} (untrusted destination)`;
}

/**
 * Is this host an identity provider we recognise?
 *
 * Split out from `isTrustedLogoutDestination` because that function also accepts anything
 * on the target's own domain — correct for its purpose, and wrong for asking "did a
 * provider hand the user here", where passing a host's own domain as the target makes
 * every site vouch for itself. A test caught exactly that.
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isIdentityProvider(host) {
  if (!host) return false;
  return TRUSTED_IDP_DOMAINS.has(host) || TRUSTED_IDP_DOMAINS.has(registrableDomain(host));
}
