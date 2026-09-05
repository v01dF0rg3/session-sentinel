/**
 * What a user can actually do about sessions the extension cannot reach.
 *
 * The honest counterpart to automation that cannot verify server state. Clearing cookies
 * locally can leave a server token active and usable by someone who already copied it.
 * Something has to direct the user to provider-owned session and security controls.
 *
 * Three situations, three different answers, and the difference matters:
 *
 *   'individual'   The site lists sessions but revokes them one at a time. Confirmed for
 *                  GitHub. Tedious but possible, and the link is worth having.
 *   'page'         The site has a sessions or security page; whether it offers a bulk
 *                  revoke has not been checked. Point at it and say so.
 *   'passwordOnly' No session page is known. Point to security settings and explain that
 *                  a password change may help but is not a universal session revocation.
 *
 * Pure - no chrome.* here.
 */

import { SESSION_PAGES } from '../../data/session-pages.js';

/**
 * @typedef {object} RevokeGuidance
 * @property {'individual' | 'page' | 'passwordOnly'} kind
 * @property {string} message What the user should do, in plain words.
 * @property {string} [url]
 * @property {string} [label]
 */

/**
 * @param {string} domain Registrable domain.
 * @returns {{ url: string, label: string, revoke: string } | null}
 */
export function sessionPageFor(domain) {
  return SESSION_PAGES[domain] ?? null;
}

/**
 * Where the user can review this site's sessions and security controls.
 *
 * `logoutAttempted` changes the message rather than the links. Reaching a site's logout is
 * stronger than deleting cookies without contacting it, but the extension cannot observe
 * the server's token table and therefore does not claim that a copied token was rejected.
 *
 * @param {string} domain
 * @param {boolean} [logoutAttempted] The site's own logout route/control was used.
 * @returns {RevokeGuidance}
 */
export function revokeGuidanceFor(domain, logoutAttempted = false) {
  const page = SESSION_PAGES[domain];

  if (logoutAttempted) {
    return page
      ? {
          kind: 'page',
          url: page.url,
          label: page.label,
          message:
            'The site sign-out was attempted before local data was cleared, but server-side invalidation of a copied token was not independently verified. Review active sessions here and remove anything unfamiliar.' +
            (page.reauth ? ' That page will ask you to verify your identity by email first.' : '')
        }
      : {
          kind: 'passwordOnly',
          message:
            'The site sign-out was attempted before local data was cleared, but server-side invalidation of a copied token was not independently verified. From a trusted device, review the site security settings. Change the password if it may be exposed, but do not assume that closes every session.'
        };
  }

  if (!page) {
    return {
      kind: 'passwordOnly',
      message:
        'No verified session-management page is known for this site. From a trusted device, check its account security settings for active sessions or devices. Change the password if it may be exposed, but verify sessions separately.'
    };
  }

  if (page.revoke === 'individual') {
    return {
      kind: 'individual',
      url: page.url,
      label: page.label,
      message:
        'This site has no confirmed "sign out everywhere" button. Review the list and revoke unfamiliar sessions one at a time; do not assume a password change replaces this check.' +
        (page.reauth ? ' Revoking one also requires verifying your identity by email.' : '')
    };
  }

  return {
    kind: 'page',
    url: page.url,
    label: page.label,
    message:
      'Other devices or copied tokens may still be active. Review this page, remove anything unfamiliar, and use "sign out everywhere" if the site offers it. Change the password if it may be exposed, but verify the session list afterward.'
  };
}

/**
 * Proper names for the sites we speak about by name. Naive capitalisation produces
 * "Github" and "Linkedin", which reads as carelessness in a tool asking to be trusted.
 * Anything absent falls back to its domain, which is never wrong.
 *
 * @type {Record<string, string>}
 */
const DISPLAY_NAMES = {
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'google.com': 'Google',
  'youtube.com': 'YouTube',
  'microsoft.com': 'Microsoft',
  'live.com': 'Microsoft',
  'outlook.com': 'Outlook',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'x.com': 'X',
  'linkedin.com': 'LinkedIn',
  'dropbox.com': 'Dropbox',
  'netflix.com': 'Netflix',
  'spotify.com': 'Spotify',
  'twitch.tv': 'Twitch',
  'reddit.com': 'Reddit',
  'apple.com': 'Apple',
  'icloud.com': 'iCloud',
  'amazon.com': 'Amazon',
  'paypal.com': 'PayPal',
  'zoom.us': 'Zoom',
  'slack.com': 'Slack',
  'discord.com': 'Discord',
  'proton.me': 'Proton',
  'protonmail.com': 'Proton'
};

/**
 * @typedef {object} CompromiseAdvice
 * @property {string} domain
 * @property {string} title
 * @property {string} explanation Why the extension cannot do this for them.
 * @property {string} advice Safe next steps without promising universal revocation.
 * @property {string} [passwordUrl] Direct link, where one is known.
 * @property {string} siteUrl The site itself - always present, as a starting point.
 * @property {string} [sessionsUrl]
 * @property {string} [sessionsLabel]
 */

/**
 * What to tell someone who may be compromised, before logging them out.
 *
 * The order matters. If malware may be active, account recovery belongs on another trusted
 * device. Review active sessions first, revoke unfamiliar entries or use a site's own
 * sign-out-everywhere control, then change exposed credentials and review MFA/recovery
 * methods. Password changes vary by provider and are never described as universal session
 * revocation.
 *
 * Advice is offered for EVERY site. Even a separately tested global recipe cannot make an
 * infected device safe or inspect the provider's token database. What degrades is the
 * specificity, never the honesty:
 *
 *   known session page    a direct link to review sessions/devices
 *   known password page   a second direct link when credentials may be exposed
 *   nothing known         the site itself, and the security controls to look for
 *
 * @param {string} domain
 * @param {boolean} [hasVerifiedGlobalRecipe] Whether a separately tested global recipe is known.
 * @returns {CompromiseAdvice}
 */
export function compromiseAdviceFor(domain, hasVerifiedGlobalRecipe = false) {
  const page = SESSION_PAGES[domain];
  const pretty = DISPLAY_NAMES[domain] ?? domain;

  const explanation = hasVerifiedGlobalRecipe
    ? `${pretty} has a separately tested revoke-everywhere recipe, but Session Sentinel still cannot inspect the provider's token state or make an infected device safe.`
    : !page
      ? `Session Sentinel cannot verify that ${pretty}'s logout invalidates a copied token, and no session list is known for it.`
      : page.revoke === 'individual'
        ? `${pretty} has no confirmed "sign out everywhere" control; review and revoke sessions one at a time` +
          (page.reauth ? ', and each one needs you to verify your identity by email.' : '.')
        : `Session Sentinel cannot verify that ${pretty}'s logout invalidates copied tokens or sessions on other devices.`;

  const advice =
    'If malware may be active, stop and use another trusted device. Review active sessions or devices, remove anything unfamiliar, and use "sign out everywhere" if offered. Review connected apps, app passwords, MFA and recovery methods for unfamiliar access. Change an exposed password promptly, following the provider\'s recovery instructions. Only view or generate backup codes on your trusted device. A password change does not guarantee every session is closed.';

  return {
    domain,
    title: `${pretty}: recover from a trusted device`,
    explanation,
    advice,
    passwordUrl: page?.password,
    // Somewhere to start when there is no direct link. The user knows their own sites;
    // guessing a settings path would only send them somewhere wrong with confidence.
    siteUrl: `https://${domain}`,
    sessionsUrl: page?.url,
    sessionsLabel: page?.label
  };
}

/** @returns {number} How many sites have a known session page. */
export function sessionPageCount() {
  return Object.keys(SESSION_PAGES).length;
}
