# Privacy Policy — Session Sentinel

Last updated: 2 September 2026. Applies to version 0.34.0.

## The short version

Session Sentinel has no user account, analytics, advertising, or telemetry, and it does
not sell your data or upload your account list. Account decisions, settings, and reports
stay in your Chrome profile. The extension does make the feature-specific network requests
listed below; websites and the optional recipe host can see an ordinary request and its IP
address.

## What it reads

| Data | Why | Where it goes |
|---|---|---|
| Your cookies (names, domains, flags, and value length) | To find login evidence and delete site cookies. Chrome returns cookie values, but Session Sentinel does not display, store, compare, or transmit their contents. | Never leaves your device |
| Open tab URLs | To identify the current site, find tabs on a selected domain, and optionally reload them after local cleanup | Never leaves your device |
| Limited page UI (sign-in, sign-out, account-control text, links, and attributes) | To find positive login evidence and activate a site's own sign-in or sign-out control | Used in memory on your device; form values and passwords are not read |
| Site storage (localStorage, IndexedDB, service workers, cache storage) | Deleted, per site, when you clear a session | Never read into the extension; only deleted |
| Your settings and last run report | To remember your preferences and show what happened | `chrome.storage.local`, on your device |

The extension does not read form values, passwords, or Chrome browsing history. It does not
transmit the limited page evidence described above.

## Network requests it makes

Session Sentinel may contact a target site while attempting sign-out or locating its
provider-owned security controls:

1. Public well-known and conventional routes, such as OpenID configuration, logout paths,
   and `/.well-known/change-password`, may be checked to find a site-owned destination.
2. The site's own page may load in a temporary background tab inside an existing Chrome
   window so its sign-out control can be used with the browser's normal site context.
3. Selecting **Login**, a session/security link, or a password-settings link opens the
   provider-owned page the user requested.

There is one separate, manual diagnostics experiment. If you explicitly enter a domain
and press **Probe privately**, the extension loads that site's homepage once in a fresh,
empty Incognito cookie store. It compares cookie **names** with the normal profile to test
whether the site gives the same auth-looking names to visitors with no account. The result
is displayed for diagnosis but no account verdict or baseline is saved. Cookie values are
never displayed, stored, or sent anywhere. The site sees an ordinary Incognito visit;
closing every Incognito window erases the temporary private cookies and site data.

If optional recipe updates are enabled, one request is made to the public bundle host as
described below. No per-site request is sent to that host, and no account or site list is
uploaded.

## What it does not do

- No user accounts, sign-in, or identifiers
- No analytics, crash reporting, or usage statistics
- No advertising, and no data sold or shared with third parties
- No remote code execution — everything that runs ships inside the extension package
- No reading of passwords or form values, and no transmission of page evidence

## Why it needs access to all sites

Session Sentinel requests access to all websites (`<all_urls>`). Chrome provides no
authoritative list of every site where a user is signed in, and the extension cannot know
in advance which sites may contain login evidence or need user-requested cleanup.

The alternative, asking for permission site by site, could make a requested cleanup
incomplete without clearly identifying every site it had to skip.

This access is used to inspect the limited account controls described above, delete local
session data, operate sites' own sign-out controls, and run the one-domain private-store
experiment only when the user presses its button.

## Recipe updates (off by default)

Session Sentinel can download an updated list of site logout recipes. **This is switched
off unless you turn it on** in settings.

When enabled, once a week it makes a single request for the entire recipe list:

- The **whole list** is downloaded at once. The extension never asks "what is the recipe
  for this site?", because such a request would tell the server which sites you use — the
  exact thing this extension exists to protect.
- The request is sent **without cookies and without a referrer**, so it carries no
  identifier. The server sees an IP address downloading a public file, and nothing else.
- Nothing about you, your settings, or your sites is uploaded. It is a download only.
- The bundle is **cryptographically signed**, and an update that fails verification is
  discarded. The recipes built into the extension stay in force.

Turning the setting off stops all network activity of this kind, including the scheduled
check.

## Most-visited sites (optional, off by default)

Session Sentinel can order equally-sensitive confirmed accounts by how often you use them, so a
breach recovery starts with the accounts you actually live in. **This is off unless you
turn it on**, and turning it on asks Chrome for a separate permission you can refuse or
revoke at any time.

- It uses `chrome.topSites` — the short list of sites Chrome puts on your new-tab page —
  not your browsing history. No page URLs, no timestamps, no visit counts.
- The list is read on the machine, used to sort a list, and never stored or transmitted.
- A top-site entry never confirms an account or moves a possible account into recovery.
- It **never changes how risky a site is considered**. A news site read daily is not more
  dangerous to lose than a bank visited twice a year, and treating it as such would get the
  ordering exactly backwards. It only breaks ties between confirmed accounts already judged
  equally sensitive.

Switching it off removes the permission.

## Your control

- Pause all protection from the toolbar popup at any time
- Mark any site "never clear" so it is skipped by everything automatic
- Uninstalling removes all stored settings

## Contact

Questions about this policy can be raised through the extension's listing page or its
source repository.
