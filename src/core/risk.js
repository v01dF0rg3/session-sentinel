/**
 * Risk classification. Pure - no chrome.* here, so it is unit-testable in plain node.
 *
 * The tier a site lands in decides everything the user never has to configure: whether
 * it is wiped when the browser closes, how long it survives idle, and how hard the
 * engine tries to reach the server-side logout.
 */

import { DOMAIN_RISK, KEYWORD_RISK, TLD_RISK } from '../../data/risk-domains.js';

/** @typedef {'critical' | 'high' | 'medium' | 'low'} RiskTier */

/** @type {RiskTier[]} Most to least severe. */
export const TIERS = ['critical', 'high', 'medium', 'low'];

const TIER_RANK = /** @type {Record<RiskTier, number>} */ ({
  critical: 0, high: 1, medium: 2, low: 3
});

/**
 * True when `a` is at least as severe as `b`.
 * @param {RiskTier} a
 * @param {RiskTier} b
 * @returns {boolean}
 */
export function atLeast(a, b) {
  return TIER_RANK[a] <= TIER_RANK[b];
}

/**
 * @param {string} registrable A registrable domain, e.g. "chase.com".
 * @returns {{ tier: RiskTier, reason: string }}
 */
export function classify(registrable) {
  const domain = registrable.toLowerCase();

  const listed = DOMAIN_RISK[domain];
  if (listed) return { tier: listed, reason: 'known site' };

  // A subdomain of a listed site inherits its tier, so `console.aws.amazon.com`
  // is covered by `amazon.com` even though the registrable domain differs.
  for (const [known, tier] of Object.entries(DOMAIN_RISK)) {
    if (domain.endsWith(`.${known}`)) return { tier, reason: `part of ${known}` };
  }

  for (const [pattern, tier] of TLD_RISK) {
    if (pattern.test(domain)) return { tier, reason: 'sensitive domain suffix' };
  }

  for (const [pattern, tier] of KEYWORD_RISK) {
    if (pattern.test(domain)) return { tier, reason: 'name suggests sensitive service' };
  }

  return { tier: 'low', reason: 'unclassified' };
}

/**
 * Cookies that look like they carry an authenticated session. Used only to decide
 * whether to *show* a site as logged in and how to rank it - never to gate removal,
 * so a false negative costs visibility, not protection.
 *
 * Two patterns rather than one: real session cookies run their words together
 * (`sessionid`, `PHPSESSID`, `JSESSIONID`), so those stems have to match anywhere in
 * the name. The vaguer stems stay anchored to word boundaries, or `uid` would match
 * `build_id` and `user` would match half the analytics cookies on the web.
 */
const STRONG_SESSION_STEM = /(sess|sid\b|auth|token|jwt|login|logged|oauth|identity|credential)/i;
const WEAK_SESSION_STEM = /(^|[_.-])(user|uid|account|remember|access|refresh|me)([_.-]|$)/i;

/**
 * @param {string} name
 * @returns {boolean}
 */
export function looksLikeSessionCookie(name) {
  return STRONG_SESSION_STEM.test(name) || WEAK_SESSION_STEM.test(name);
}

/**
 * @typedef {'strong' | 'moderate' | 'weak' | 'none'} SessionEvidence
 */

/**
 * How strongly one cookie suggests the user is actually signed in.
 *
 * `looksLikeSessionCookie` above answers a different question — "might this cookie carry a
 * session, and therefore be worth destroying" — and it is deliberately generous, because
 * the cost of missing one is leaving a live token behind. Asking that same generous
 * question to decide what to *show* produced a list of 225 sites containing accounts the
 * user does not have.
 *
 * The discriminator is `httpOnly`. Analytics, consent and preference cookies must be
 * readable by page scripts or they are useless — `_ga`, `OptanonConsent`, `__utm*` are all
 * JS-visible. Real auth cookies are set httpOnly precisely so that a cross-site script
 * cannot steal them. Nothing else separates the two nearly as cleanly: expiry does not
 * (plenty of analytics cookies are session-scoped, which is exactly the bug), and neither
 * does the name alone.
 *
 * Value length is a weak second signal. A session token is an opaque random string; a
 * preference cookie is "1" or "en-GB".
 *
 * @param {{ name: string, value?: string, httpOnly?: boolean, secure?: boolean }} cookie
 * @returns {SessionEvidence}
 */
export function sessionEvidence(cookie) {
  const named = STRONG_SESSION_STEM.test(cookie.name);
  const opaque = (cookie.value?.length ?? 0) >= 16;

  // httpOnly and Secure together, with a name that says session and a value long enough to
  // be one. This is what a real auth cookie looks like on every stack worth naming.
  if (named && cookie.httpOnly && cookie.secure && opaque) return 'strong';

  // An unmistakable name and unreadable to scripts, but missing Secure or short. Common on
  // older stacks and on http-only intranets.
  if (named && cookie.httpOnly) return 'moderate';

  // Scripts can read it. It may still be a session cookie on a stack that reads its token
  // from JS, so it is not dismissed - but on its own it means very little.
  if (named && opaque) return 'weak';
  if (WEAK_SESSION_STEM.test(cookie.name)) return 'weak';
  return 'none';
}
