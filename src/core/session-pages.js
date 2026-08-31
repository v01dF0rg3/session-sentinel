/**
 * What a user can actually do about sessions the extension cannot reach.
 *
 * The honest counterpart to automation that did not work. Clearing cookies locally does
 * not end a session on the site's side — it orphans it, leaving it listed as active and
 * usable by anyone holding the token. Something has to tell the user that, and tell them
 * what would genuinely finish the job.
 *
 * Three situations, three different answers, and the difference matters:
 *
 *   'individual'   The site lists sessions but revokes them one at a time. Confirmed for
 *                  GitHub. Tedious but possible, and the link is worth having.
 *   'page'         The site has a sessions or security page; whether it offers a bulk
 *                  revoke has not been checked. Point at it and say so.
 *   'passwordOnly' No session page is known. On most sites a password change is what
 *                  actually invalidates other sessions, so that is the honest advice —
 *                  hedged, because absence from a 23-entry list is not proof.
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
 * How this site's other sessions can actually be ended.
 *
 * `endedHere` changes the message rather than the links. Using the site's own sign-out
 * ends this browser's session properly, so the only thing left is other devices - a
 * materially better position than an abandoned session that is still listed as live, and
 * the user should be able to tell the two apart.
 *
 * @param {string} domain
 * @param {boolean} [endedHere] The site's own logout was used successfully.
 * @returns {RevokeGuidance}
 */
export function revokeGuidanceFor(domain, endedHere = false) {
  const page = SESSION_PAGES[domain];

  if (endedHere) {
    return page
      ? {
          kind: 'page',
          url: page.url,
          label: page.label,
          message:
            'This browser is signed out properly, not just cleared. Sessions on your other devices are untouched — end those here if you want to.' +
            (page.reauth ? ' That page will ask you to verify your identity by email first.' : '')
        }
      : {
          kind: 'passwordOnly',
          message: 'This browser is signed out properly, not just cleared. Sessions on your other devices are untouched; changing your password is the usual way to end those.'
        };
  }

  if (!page) {
    return {
      kind: 'passwordOnly',
      message:
        'No way to sign out other devices is known for this site. Check its account security settings — and if there is nothing there, changing your password is usually the only thing that ends sessions elsewhere.'
    };
  }

  if (page.revoke === 'individual') {
    return {
      kind: 'individual',
      url: page.url,
      label: page.label,
      message:
        'This site has no "sign out everywhere" button — sessions must be revoked one at a time from the list, or ended all at once by changing your password.' +
        (page.reauth ? ' Revoking one also requires verifying your identity by email.' : '')
    };
  }

  return {
    kind: 'page',
    url: page.url,
    label: page.label,
    message:
      'Other devices may still be signed in. Revoke them from the page below if it offers it; changing your password is the reliable fallback.'
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
  'discord.com': 'Discord'
};

/**
 * @typedef {object} CompromiseAdvice
 * @property {string} domain
 * @property {string} title
 * @property {string} explanation Why the extension cannot do this for them.
 * @property {string} advice What actually ends every other session.
 * @property {string} [passwordUrl]
 * @property {string} [sessionsUrl]
 * @property {string} [sessionsLabel]
 */

/**
 * What to tell someone who may be compromised, before logging them out.
 *
 * The order matters and is the whole point. If an attacker holds a live session, logging
 * *yourself* out is the wrong first move: it surrenders the one authenticated session you
 * control while leaving theirs untouched. Changing the password from the session you
 * already have terminates every other session at once and keeps you signed in.
 *
 * So this is offered before the logout runs, not after it - by then the useful option has
 * been thrown away.
 *
 * Returns null when there is nothing actionable to offer, so the caller can just log out.
 *
 * @param {string} domain
 * @returns {CompromiseAdvice | null}
 */
export function compromiseAdviceFor(domain) {
  const page = SESSION_PAGES[domain];
  if (!page?.password) return null;

  const pretty = DISPLAY_NAMES[domain] ?? domain;

  return {
    domain,
    title: `${pretty} cannot sign out your other devices`,
    explanation:
      page.revoke === 'individual'
        ? `${pretty} has no "sign out everywhere" control — sessions are revoked one at a time` +
          (page.reauth ? ', and each one needs you to verify your identity by email.' : '.')
        : `${pretty} offers no way for an extension to end sessions on your other devices.`,
    advice:
      'If you think someone else is using your account, change your password instead. That ends every other session immediately, everywhere — and leaves this window signed in, which logging out would not.',
    passwordUrl: page.password,
    sessionsUrl: page.url,
    sessionsLabel: page.label
  };
}

/** @returns {number} How many sites have a known session page. */
export function sessionPageCount() {
  return Object.keys(SESSION_PAGES).length;
}
