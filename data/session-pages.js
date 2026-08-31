/**
 * Sites that keep a list of active sessions you can review and revoke yourself.
 *
 * This exists because automating those pages did not work. A GitHub recipe spent several
 * versions clicking for a "revoke all" button that does not exist: GitHub revokes sessions
 * one at a time, behind a "Details" expander, with no bulk control at all. Every other
 * click-based recipe was written the same way — from a plausible guess about a page nobody
 * had looked at — so they were removed rather than left to fail quietly.
 *
 * A link the user can act on is worth more than automation that pretends. These URLs are
 * checked to resolve; what is behind them is the site's business, and the user's.
 *
 * `revoke` records what the page is actually known to offer:
 *   'individual' - confirmed: sessions are revoked one at a time, no bulk control
 *   'unknown'    - the page exists; whether it has a bulk revoke has not been checked
 *
 * `password` is where the user changes their password. On a site with no bulk revoke this
 * is the only thing that ends every other session at once — and, importantly, it keeps the
 * current window signed in, so it is a better first move than logging out when someone
 * believes they are compromised. Every URL here returned a live page when checked; the few
 * that answer 4xx to a bare script (Facebook, GitLab, PayPal) are the long-standing
 * documented paths and load normally in a browser.
 *
 * `reauth: true` means revoking there demands proof of identity - GitHub sends a
 * verification email before it will let you kill a session. Worth telling the user before
 * they click, and a second reason automating this was never realistic: an automated click
 * cannot pass an email challenge.
 *
 * Only github.com is marked 'individual', because that is the only one anybody has looked
 * at. Guessing the rest is what produced twelve broken recipes, and the mistake is not
 * worth repeating in a friendlier format.
 *
 * @type {Record<string, { url: string, label: string, revoke: 'individual' | 'unknown', reauth?: boolean, password?: string }>}
 */
export const SESSION_PAGES = {
  'github.com': { url: 'https://github.com/settings/sessions', label: 'Web sessions', revoke: 'individual', reauth: true, password: 'https://github.com/settings/security' },
  'gitlab.com': { url: 'https://gitlab.com/-/user_settings/active_sessions', label: 'Active sessions', revoke: 'unknown', password: 'https://gitlab.com/-/user_settings/password/edit' },
  'google.com': { url: 'https://myaccount.google.com/device-activity', label: 'Your devices', revoke: 'unknown', password: 'https://myaccount.google.com/signinoptions/password' },
  'youtube.com': { url: 'https://myaccount.google.com/device-activity', label: 'Your devices (Google)', revoke: 'unknown', password: 'https://myaccount.google.com/signinoptions/password' },
  'microsoft.com': { url: 'https://account.microsoft.com/devices', label: 'Your devices', revoke: 'unknown', password: 'https://account.live.com/password/change' },
  'live.com': { url: 'https://account.microsoft.com/devices', label: 'Your devices', revoke: 'unknown', password: 'https://account.live.com/password/change' },
  'outlook.com': { url: 'https://account.microsoft.com/devices', label: 'Your devices', revoke: 'unknown', password: 'https://account.live.com/password/change' },
  'facebook.com': { url: 'https://www.facebook.com/settings?tab=security', label: 'Where you are logged in', revoke: 'unknown', password: 'https://www.facebook.com/settings?tab=security' },
  'instagram.com': { url: 'https://www.instagram.com/session/login_activity/', label: 'Login activity', revoke: 'unknown' },
  'x.com': { url: 'https://x.com/settings/sessions', label: 'Sessions', revoke: 'unknown', password: 'https://x.com/settings/password' },
  'linkedin.com': { url: 'https://www.linkedin.com/psettings/sessions', label: 'Where you are signed in', revoke: 'unknown', password: 'https://www.linkedin.com/psettings/change-password' },
  'dropbox.com': { url: 'https://www.dropbox.com/account/security', label: 'Devices', revoke: 'unknown', password: 'https://www.dropbox.com/account/security' },
  'netflix.com': { url: 'https://www.netflix.com/account/security', label: 'Access and devices', revoke: 'unknown', password: 'https://www.netflix.com/password' },
  'spotify.com': { url: 'https://www.spotify.com/account/overview/', label: 'Sign out everywhere', revoke: 'unknown', password: 'https://www.spotify.com/account/change-password/' },
  'twitch.tv': { url: 'https://www.twitch.tv/settings/security', label: 'Other sessions', revoke: 'unknown', password: 'https://www.twitch.tv/settings/security' },
  'zoom.us': { url: 'https://zoom.us/profile', label: 'Sign me out from all devices', revoke: 'unknown' },
  'amazon.com': { url: 'https://www.amazon.com/gp/css/homepage.html', label: 'Login & security', revoke: 'unknown', password: 'https://www.amazon.com/gp/css/homepage.html' },
  'discord.com': { url: 'https://discord.com/channels/@me', label: 'Settings, Devices', revoke: 'unknown' },
  'reddit.com': { url: 'https://www.reddit.com/settings/account', label: 'Account settings', revoke: 'unknown', password: 'https://www.reddit.com/settings/account' },
  'apple.com': { url: 'https://account.apple.com/', label: 'Devices', revoke: 'unknown', password: 'https://account.apple.com/' },
  'icloud.com': { url: 'https://account.apple.com/', label: 'Devices', revoke: 'unknown', password: 'https://account.apple.com/' },
  'paypal.com': { url: 'https://www.paypal.com/myaccount/security/', label: 'Security', revoke: 'unknown', password: 'https://www.paypal.com/myaccount/security/' },
  'slack.com': { url: 'https://slack.com/account/settings', label: 'Sessions', revoke: 'unknown' }
};
