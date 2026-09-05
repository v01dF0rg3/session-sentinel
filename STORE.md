# Chrome Web Store submission notes

Everything the listing form asks for, drafted. Not yet submitted.

## Single purpose

> Session Sentinel attempts website sign-out and clears local session data — on demand, or
> automatically after inactivity, on screen lock, or around browser close.

Chrome requires one narrow purpose. Every permission below traces to it.

## Permission justifications

The store asks for these one at a time. Each answer states the concrete feature.

| Permission | Justification |
|---|---|
| `cookies` | Reads cookie metadata as one source of login evidence; deletes individual cookies in the normal profile, including partitioned cookies, and reads back the result. Cookie presence alone is not proof of an account. Diagnostics create and remove two public dummy cookies on a reserved test domain. |
| `browsingData` | Requests localStorage, IndexedDB, service worker, cache storage, and file-system cleanup for concrete site origins. Not used to delete cookies. Successful API completion is not independent storage-content verification. |
| `tabs` | Identifies the current site, finds and optionally reloads matching user tabs after local cleanup, hosts temporary sign-out work tabs in an existing window, and supports a manual diagnostic in an already-open Incognito window. The extension never closes a user tab or creates or removes a browser window. |
| `scripting` | Reads limited page UI needed to identify account/sign-in/sign-out controls and operates a site's own sign-out control inside a work tab. It never reads form values or passwords and does not transmit the page evidence. |
| `storage` | Saves settings, local account decisions, run checkpoints, cleanup evidence, and unfinished startup retry domains locally. |
| `alarms` | Schedules periodic wakeups during a long multi-site run and the optional weekly recipe check. It does not guarantee that Chrome keeps the worker alive. |
| `idle` | Detects inactivity and screen lock, which are two automatic cleanup triggers the user can enable. |
| `notifications` | Shows automatic cleanup results, separating sign-out attempts, local-only clearing, and results that need attention. No result claims verified remote revocation. |
| `host_permissions: <all_urls>` | The extension cannot know in advance which sites may contain login evidence or need user-requested cleanup. Access is used to inspect account controls, delete local session data, operate sites' own sign-out controls, and load one user-entered domain during the explicit private-store diagnostic. Data is not transmitted. |

### Optional permissions

| Permission | Justification |
|---|---|
| `topSites` | Optional and off by default. Orders equally-sensitive, already-confirmed accounts in the breach-recovery checklist by how often the user visits them. Read on the device, used only to sort, never stored or transmitted. It cannot confirm an account, add a site to recovery, or affect risk. |

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

> Attempt site sign-out and clear local session data on demand, after inactivity, on lock,
> or around browser close—with honest results.

**Detailed description:**

> Session Sentinel helps reduce exposure from browser sessions without pretending it can
> see or revoke every token.
>
> Press one button and it works through accounts backed by positive login evidence. Or let
> configured local cleanup run after inactivity, on screen lock, or around browser close.
>
> **It tells you the truth about what it achieved.**
>
> "Log out" means different things on different sites. Session Sentinel separates a reached
> sign-out route or control from cookie readback and Chrome's acceptance of local storage
> cleanup. It does not verify remote revocation. A token copied earlier may still work, so its recovery checklist directs you to
> provider-owned session lists and security settings from a trusted device.
>
> **It will not surprise you.**
>
> Nothing automatic happens until you have seen a setup page showing the current sites
> scheduled for cleanup. Tick "Never clear this site" on anything you want left alone —
> a music player, a home dashboard — and it is skipped by every automatic trigger and by
> the main logout button too.
>
> High-risk sites — banking, email, cloud consoles — can receive stronger automatic local
> cleanup. Everyday sites are left alone unless the configured trigger includes them.
>
> **Private by construction.** No account or telemetry. Account decisions stay on your
> computer; optional recipe updates fetch one public bundle without sending your site list.

## Category

Productivity › Workflow & Planning, or Privacy & Security if available.

## Screenshots needed (1280×800)

1. The popup mid-run, showing mixed honest results
2. The setup page, showing affected sites and the exemption checkboxes
3. The settings page, showing the automatic triggers
4. A close-up of the "Never clear this site" control

## Before submitting

- [ ] Complete the manual smoke test in [TESTING.md](TESTING.md) on a clean profile
- [ ] Complete and record the release gates in [SECURITY.md](SECURITY.md), including real
      browser cookie canaries and provider-specific throwaway-account checks
- [ ] Keep every recipe result at an attempt. A historical date or an independent second
      device's session is not proof about a copied token or this run
- [ ] Capture the four screenshots
- [ ] Confirm the privacy policy is reachable at a public URL
