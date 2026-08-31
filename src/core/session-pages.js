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

/** @returns {number} How many sites have a known session page. */
export function sessionPageCount() {
  return Object.keys(SESSION_PAGES).length;
}
