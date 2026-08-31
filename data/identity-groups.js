/**
 * Domains that share one sign-in.
 *
 * Clearing one member of a group and leaving the others alone does not log the user out:
 * the surviving session silently re-issues cookies for the cleared site the moment it is
 * visited. Clearing youtube.com while google.com stays signed in is the obvious case —
 * accounts.google.com hands YouTube a fresh session immediately, and from the user's point
 * of view the logout simply did not happen.
 *
 * Only groups where a single identity provider genuinely re-authenticates the others
 * belong here. Companies that merely share an owner do not: Amazon owns Twitch, but a
 * Twitch session is not restored by an Amazon one, and grouping them would sign people out
 * of things they never asked about.
 *
 * @type {string[][]}
 */
export const IDENTITY_GROUPS = [
  // Google: accounts.google.com re-issues sessions for every property.
  ['google.com', 'youtube.com', 'gmail.com', 'googlemail.com', 'blogger.com', 'google.co.uk'],

  // Microsoft: one Entra/live.com identity behind all of them.
  ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com', 'azure.com', 'sharepoint.com', 'xbox.com'],

  // Meta: Instagram sign-in is backed by Facebook's session.
  ['facebook.com', 'instagram.com', 'messenger.com', 'meta.com'],

  // Apple.
  ['apple.com', 'icloud.com'],

  // Yahoo owns AOL and shares the login.
  ['yahoo.com', 'aol.com'],

  // Atlassian cloud.
  ['atlassian.com', 'atlassian.net']
];
