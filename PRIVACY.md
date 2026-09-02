# Privacy Policy — Session Sentinel

Last updated: 2 September 2026. Applies to version 0.27.4.

## The short version

Session Sentinel does not collect, transmit, or sell any of your data. There is no
account, no server, no analytics, and no telemetry. Everything it knows stays in your
browser profile on your computer.

## What it reads

| Data | Why | Where it goes |
|---|---|---|
| Your cookies (names, domains, flags) | To find which sites you are signed into, and to delete session cookies | Never leaves your device |
| Open tab URLs | To identify the current site, and to close tabs on a site before clearing it | Never leaves your device |
| Site storage (localStorage, IndexedDB, service workers, cache storage) | Deleted, per site, when you clear a session | Never read into the extension; only deleted |
| Your settings and last run report | To remember your preferences and show what happened | `chrome.storage.local`, on your device |

The extension never reads page content, form fields, passwords, or browsing history.

## Network requests it makes

Session Sentinel normally contacts only the sites you are logging out of, and only while
performing a logout:

1. **A `GET` to `https://<site>/.well-known/openid-configuration`** — a public, standard
   discovery file, requested without credentials, to find the site's official sign-out
   endpoint.
2. **Loading the site's own logout or sessions page in a hidden background tab**, so its
   sign-out control can be used the way you would use it yourself.

There is one separate, manual diagnostics experiment. If you explicitly enter a domain
and press **Probe privately**, the extension loads that site's homepage once in a fresh,
empty Incognito cookie store. It compares cookie **names** with the normal profile to test
whether the site gives the same auth-looking names to visitors with no account. The result
is displayed for diagnosis but no account verdict or baseline is saved. Cookie values are
never displayed, stored, or sent anywhere. The site sees an ordinary Incognito visit;
closing every Incognito window erases the temporary private cookies and site data.

No request is ever made to any server operated by the extension's author, and no list of
your sites is transmitted anywhere.

## What it does not do

- No user accounts, sign-in, or identifiers
- No analytics, crash reporting, or usage statistics
- No advertising, and no data sold or shared with third parties
- No remote code execution — everything that runs ships inside the extension package
- No reading or transmitting page content

## Why it needs access to all sites

Session Sentinel requests access to all websites (`<all_urls>`). It needs this because it
cannot know in advance which sites you are signed into — that is precisely what it exists
to find and clear.

The alternative, asking for permission site by site, would mean the extension silently
does nothing on sites you never explicitly approved, while its icon sits in your toolbar
implying you are protected. A security tool that quietly fails is worse than one that asks
once, honestly.

This access is used to delete session data, operate sites' own logout controls, and run the
one-domain private-store experiment only when the user presses its button.

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
