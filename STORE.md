# Chrome Web Store submission notes

Everything the listing form asks for, drafted. Not yet submitted.

## Single purpose

> Session Sentinel ends the user's website sessions — on demand, or automatically after
> inactivity, on screen lock, or when the browser closes.

Chrome requires one narrow purpose. Every permission below traces to it.

## Permission justifications

The store asks for these one at a time. Each answer states the concrete feature.

| Permission | Justification |
|---|---|
| `cookies` | Reads cookie names and domains to detect which sites the user is signed into, and deletes session cookies when clearing a site. |
| `browsingData` | Deletes cookies and site storage (localStorage, IndexedDB, service workers, cache storage) for a specific site when the user logs out of it. |
| `tabs` | Identifies the current site for the popup's per-site actions, and reloads the user's tabs on a site after clearing it so the signed-out state is visible. The extension never closes a tab or window belonging to the user. |
| `scripting` | Operates a site's own "sign out of all devices" control inside a background tab. This is the only way to invalidate a session server-side rather than merely deleting the local copy. |
| `storage` | Saves the user's settings and the report of the last run, locally. |
| `alarms` | Keeps the service worker alive during a multi-site logout, which can take longer than the service worker idle timeout. |
| `idle` | Detects inactivity and screen lock, which are two of the automatic logout triggers the user can enable. |
| `notifications` | Shows the result of an automatic logout, so the user knows what was revoked, what was only cleared locally, and what failed. |
| `host_permissions: <all_urls>` | The extension cannot know in advance which sites the user is signed into — finding and clearing them is its entire purpose. Access is used only to delete session data and to operate sites' own logout controls. Page content is never read or transmitted. |

## Remote code

None. All logic ships in the package. Logout recipes are inert JSON-shaped data
interpreted by code inside the extension; nothing is `eval`'d or fetched as script.

## Data usage disclosures

- **Does the extension collect user data?** No.
- Not sold to third parties, not used for anything unrelated to its single purpose, not
  used for creditworthiness or lending.
- Privacy policy: [PRIVACY.md](PRIVACY.md)

## Listing copy

**Name:** Session Sentinel

**Short description** (132 char limit):

> End your web sessions on demand, after inactivity, on screen lock, or when the browser
> closes. Honest about what it can and cannot do.

**Detailed description:**

> Session Sentinel clears the sessions that let someone act as you.
>
> Press one button and it works through every site you are signed into. Or let it run on
> its own: when you close the browser, after you have been away for a while, or the moment
> your screen locks.
>
> **It tells you the truth about what it achieved.**
>
>  "Log out everywhere" means different things on different sites, and most tools blur the
> difference. Session Sentinel does not. It clears your local session and says exactly
> that, because a token stolen earlier may still work elsewhere. Where a site offers a real
> "sign out of all devices" control it will use it — and it only reports the stronger
> result for sites whose behaviour has been confirmed on a second device. You always know
> which protection you actually got.
>
> **It will not surprise you.**
>
> Nothing automatic happens until you have seen a setup page showing precisely which sites
> will be affected. Tick "Never clear this site" on anything you want to stay signed into —
> a music player, a home dashboard — and it is skipped by every automatic trigger and by
> the main logout button too.
>
> High-risk sites — banking, email, cloud consoles — are protected automatically. Everyday
> sites are left alone unless you ask.
>
> **Private by construction.** No account. No telemetry. No servers. What it learns about
> your browsing never leaves your computer.

## Category

Productivity › Workflow & Planning, or Privacy & Security if available.

## Screenshots needed (1280×800)

1. The popup mid-run, showing mixed honest results
2. The setup page, showing affected sites and the exemption checkboxes
3. The settings page, showing the automatic triggers
4. A close-up of the "Never clear this site" control

## Before submitting

- [ ] Complete the manual smoke test in [TESTING.md](TESTING.md) on a clean profile
- [ ] Verify each bundled recipe against a real logged-in account and add its `verified`
      date. Until then the engine downgrades every `global` claim to a local one, so the
      extension is honest but never reports `revoked`. Verification means: sign in on a
      second device, run the logout, confirm the second device is actually signed out.
      This was not hypothetical — the GitHub recipe claimed a revocation that demonstrably
      had not happened.
- [ ] Capture the four screenshots
- [ ] Confirm the privacy policy is reachable at a public URL
