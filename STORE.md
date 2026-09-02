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
| `cookies` | Reads cookie names and domains as one source of login evidence and deletes site cookies during local cleanup. Cookie presence alone is not treated as proof of an account. |
| `browsingData` | Deletes cookies and site storage (localStorage, IndexedDB, service workers, cache storage) for a specific site during local cleanup. |
| `tabs` | Identifies the current site, finds and optionally reloads matching user tabs after local cleanup, hosts temporary sign-out work tabs in an existing window, and supports a manual diagnostic in an already-open Incognito window. The extension never closes a user tab or creates or removes a browser window. |
| `scripting` | Reads limited page UI needed to identify account/sign-in/sign-out controls and operates a site's own sign-out control inside a work tab. It never reads form values or passwords and does not transmit the page evidence. |
| `storage` | Saves the user's settings and the report of the last run, locally. |
| `alarms` | Schedules periodic wakeups during a long multi-site run and the optional weekly recipe check. It does not guarantee that Chrome keeps the worker alive. |
| `idle` | Detects inactivity and screen lock, which are two automatic cleanup triggers the user can enable. |
| `notifications` | Shows the result of automatic cleanup, separating verified revoke-recipe completion, sign-out attempts, local-only clearing, and failures. |
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
> sign-out route or control from verified revoke-everywhere behavior and from local-only
> cleanup. A token copied earlier may still work, so its recovery checklist directs you to
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
- [ ] Before marking any recipe `global`, verify it with a throwaway account on a second
      device and record its `verified` date. Until then the engine reports only a sign-out
      attempt and never reports `revoked`. Verification means: sign in on a second device,
      run the recipe, and confirm the second session can no longer be used.
      This was not hypothetical — the GitHub recipe claimed a revocation that demonstrably
      had not happened.
- [ ] Capture the four screenshots
- [ ] Confirm the privacy policy is reachable at a public URL
