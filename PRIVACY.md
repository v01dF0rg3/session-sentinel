# Privacy Policy — Session Sentinel

Last updated: 30 August 2026. Applies to version 0.4.0.

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

Session Sentinel contacts only the sites you are logging out of, and only while
performing a logout:

1. **A `GET` to `https://<site>/.well-known/openid-configuration`** — a public, standard
   discovery file, requested without credentials, to find the site's official sign-out
   endpoint.
2. **Loading the site's own logout or sessions page in a hidden background tab**, so its
   sign-out control can be used the way you would use it yourself.

That is all. No request is ever made to any server operated by the extension's author,
and no information about your browsing is sent anywhere.

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

This access is used only to delete session data and to operate sites' own logout controls.

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

## Your control

- Pause all protection from the toolbar popup at any time
- Mark any site "never clear" so it is skipped by everything automatic
- Uninstalling removes all stored settings

## Contact

Questions about this policy can be raised through the extension's listing page or its
source repository.
