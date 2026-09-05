# Testing

Four layers. The first two are automated; the last two need a real browser, because the
`chrome.*` APIs cannot run anywhere else.

## 1. Decision logic (node)

```bash
npm test
```

The Node suite covers risk classification, domain parsing, planning, navigation trust,
account evidence, result semantics, and safety copy. No real `chrome.*` calls are needed.
**This is the layer where a bug could silently wipe data the user asked us to keep or make
a security claim the extension did not verify**, which is why it has the most coverage.

## 2. Page logic and popup behavior (browser)

```bash
node dev/server.mjs 5599
```

Open `http://localhost:5599/dev/step-runner.test.html`. 25 assertions run on load, PASS or
FAIL inline. These cover `pageStep` — the function injected into real pages — against the
hiding patterns sites actually use. Every one of them exists because a naive
implementation reports success for a click that never landed.

These include origin-change races, missing origin authorization, cross-origin links/forms,
submit-button overrides, off-viewport controls, click-through overlays, and expired actions.
An injection that starts late or expires just before clicking must not activate a control.
The dev server
binds only to loopback and refuses hidden files, path traversal, and non-GET/HEAD requests.

**Run these in a visible window with a real viewport.** `pageStep` decides visibility by
hit-testing with `elementFromPoint`, which only answers for coordinates inside the viewport.
In a hidden pane, a headless run, or any window reporting `innerHeight: 0`, the test stage
scrolls out of view and **five assertions fail spuriously** — aria-label matching,
`assertPresent`, `assertAbsent`, and `waitFor`. Nothing is wrong with the extension; the
harness simply cannot see. Check `innerHeight` before believing a failure here.

The same server hosts UI previews with a stubbed `chrome.*` API:

- `/dev/popup-preview.html`
- `/dev/options-preview.html`
- `/dev/welcome-preview.html`
- `/dev/recovery-preview.html`
- `/dev/diagnostics-preview.html`

These are **generated from `src/ui/*.html` on request**, not stored. They were hand-copied
once and drifted three times; the last drift left the preview advertising "Log out of all
sessions" and a heading reading "Signed in" long after the real popup had been corrected to
"Attempt sign-out of confirmed accounts". Reviewing wording against a stale copy produces
confident wrong answers, so the copies are gone and the server rebases asset paths and
injects the stub on the fly.

### Sign-out confirmation and visible feedback

Open `/dev/popup.test.html` on the same server. It embeds the real generated popup in a
380 × 584 frame with fictional accounts. The checks reproduce a scrolled account action,
then exercise the native modal, visible warning and buttons, focus and scroll restoration,
single dispatch, recovery-only actions, prompt preferences, failures, and a short viewport.
The ten Node checks in `tests/signout-prompt.test.mjs` cover choice dispatch/state; they
do not claim to test native dialog layout or accessibility.

Also check with real keyboard input in the preview: Enter on the initial heading must do
nothing; Tab must reach the dialog controls; Escape and Cancel must return to the selected
account without starting cleanup. Expand **Why recovery may need more steps** and confirm
that the action buttons stay visible. After confirming a fictional sign-out, busy feedback
and the result should appear in view. No real account or installed-extension action is
needed for these checks.

### Cleanup evidence and failure fixtures

The popup preview includes a mixed four-site report with one local failure. Expand
**Last cleanup** and confirm that cookie readback, storage API acceptance, and website
attempts remain distinct. The **Been hacked?** and **Settings** footer must remain visible
when evidence is expanded or the account list is long.

Use `/dev/popup-preview.html?run=interrupted` for unfinished domains. The panel should open
automatically, label the interruption, retain completed evidence, and never count pending
sites as cleared. These fixtures do not act on real accounts.

The Node regressions in `cleanup.test.mjs`, `security-boundaries.test.mjs`,
`run-safety.test.mjs`, `recipe-run.test.mjs`, and `tabs.test.mjs` cover exact cookie identities,
partitions, tenant boundaries, origin hints preserved across sign-out, permission failures,
private-store exclusion, run-lock races, partial startup retries, stale recipe claims,
hostile redirects, and work-tab timeout cleanup. Chrome APIs here are fakes, not browser proof.

The logout timing regressions also cover a page promise that never settles, worker-only
post-click sleeps, immediate injection, and automatic work-tab closure followed by local
cleanup and the original tab's configured reload. They reproduce a stuck work-tab failure
without touching a real account.

### Portable recovery plan

`tests/recovery-handoff.test.mjs` checks the export's explicit field allowlist, domain and
risk validation, all-risk coverage, fresh progress, essential guidance, and large lists.

The recovery preview also has fixtures; these use fictional account data, not real cookies:

| Preview URL | Check |
| --- | --- |
| `/dev/recovery-preview.html` | Nine confirmed domains export; the low-risk confirmed domain is included even under the default high-risk filter. The Bloomberg candidate is excluded. |
| `/dev/recovery-preview.html?recovery=empty` | Essential guidance and exports still work; no suggestion that an empty list means safety. |
| `/dev/recovery-preview.html?recovery=error` | Visible error and retry; printing offers essentials only and text export stays disabled. |
| `/dev/recovery-preview.html?recovery=save-error` | Failed checkbox/scope/reset writes show an error and restore the previous selection. |
| `/dev/recovery-preview.html?recovery=large` | All 109 confirmed rows reach the printable plan; no silent truncation. |

Check a row as reviewed, change scope, and start over. The portable plan must keep fresh
unchecked boxes regardless of screen progress. Test a narrow viewport for horizontal
overflow. Browser previews exercise the real UI with a stubbed worker, not the installed
extension's Chrome APIs. Add `print=1` to a preview's query string to render the real print
styles on screen. This checks visual styling only; pagination still needs Chrome's print
preview in the installed-extension check below.

## 3. Built-in diagnostics (in Chrome, one click)

Settings → **Check it works** → **Run diagnostics**, or open
`chrome-extension://<id>/src/ui/diagnostics.html` directly.

This runs the extension's real code against the real browser APIs and reports what works.
It does not delete real website data. It counts cookie metadata, then creates an ordinary
and a partitioned cookie containing a fixed public dummy string under
`session-sentinel-selftest.invalid`. It removes them through `wipeSite` and verifies that
neither remains. Any leftovers expire in two minutes. Storage tests use the same reserved
domain. Chrome supplies real cookie values to its API, but reports never include them.

Fifteen checks, covering permissions, storage, idle detection, alarms, cookie enumeration,
ordinary and partitioned cookie canaries,
per-type data clearing, the full wipe routine, the background work-tab host, script
injection into a real page, recipes, notifications, and current-site detection.

**Run this first.** It is the fastest way to find out whether the browser-facing layer
behaves on your machine, and "Copy report" produces text you can paste back for diagnosis.

Two results deserve attention even when the overall run passes:

- *Per-type data clearing* failing for a data type means deep wipes will clear less than
  the name suggests. The engine reports that per site rather than hiding it, but it is
  better known up front.
- *Background work tab host* failing means website sign-out cannot be attempted in the
  current window. The extension never creates or closes a browser window.

Visible cookie-store count is not cleanup coverage: normal-profile cleanup must never
sweep an allowed Incognito store. Passing the storage probes proves that Chrome accepted
origin-scoped requests, not that every storage type was populated and independently verified.

## 4. Extension smoke test (manual)

**Use a separate Chrome profile.** On your normal profile this will delete real site data,
may sign you out, and can run automatic triggers on its own.

Setup: new profile → sign into two throwaway accounts (one high-risk like a webmail, one
low-risk) → `chrome://extensions` → Developer mode → Load unpacked.

Work through these in order. Each one exercises a layer that no automated test reaches.

### A. Install and onboarding

- [ ] A setup tab opens automatically on install
- [ ] It lists the sites you signed into, with plausible risk badges
- [ ] Untick one site — reopen the popup and confirm it shows as kept
- [ ] **Close and reopen the browser WITHOUT finishing setup. Nothing should be cleared.**
      This is the onboarding gate; if it fails, a fresh install can surprise a user.
- [ ] Finish setup with "Turn on automatic protection"

### B. Local destruction (Tier 0)

- [ ] Popup lists sites with confirmed login evidence first and does not list obvious junk
- [ ] **Clear data** on the low-risk site → reload it → local sign-in state is gone
- [ ] The other site is still signed in (origin scoping works)
- [ ] Run it again on a site with no cookies — reports cleanly, does not error
- [ ] Run diagnostics: both ordinary and partitioned cookie canaries are created, removed,
      and absent on readback
- [ ] With a disposable Incognito login open, normal-profile cleanup leaves it untouched;
      attempting cleanup from an Incognito popup explains that it is unsupported
- [ ] Test two disposable sibling tenants on a private suffix; selecting one leaves the
      other's cookies and storage intact

### C. Website sign-out attempt (Tiers 1, 3, 4)

- [ ] Per-site **Attempt sign-out** on a site with a recipe
- [ ] Work happens in a background tab inside an existing window; no window is created or closed
- [ ] A reached route/control says **sign-out attempted**, not **revoked**
- [ ] With a disposable GitHub account and tab reload enabled, leave the work tab alone.
      It should close by itself after the sign-out flow or page-action timeout, then the
      original GitHub tab should refresh. Do not manually close the work tab to make the
      test pass; record any stall in the activity log
- [ ] A site where no sign-out control is reached honestly says **cleared locally**
- [ ] On a throwaway account, inspect the provider's session list and test a second device's
      independent session before/after the action. Record the exact flow and limitations;
      this does not test reuse of a copied token from the first device. Do not export or
      replay production credentials as a test

### D. Confirmed-only bulk scope

- [ ] Leave at least one domain in **Log in to pre-existing accounts** unresolved
- [ ] Press **Attempt sign-out of confirmed accounts**
- [ ] The result names only confirmed accounts; the unanswered candidate is untouched

### E. Candidate login flow

- [ ] Press **Login** on a candidate where you are already signed in
- [ ] The site opens and moves into **Confirmed accounts** when its account UI is detected
- [ ] Press **Login** on a logged-out candidate and complete the site's login
- [ ] Reopen the popup; the site is now under **Confirmed accounts**

### F. Keep-site guarantee

- [ ] Tick **Never clear this site** on one site
- [ ] Press **Attempt sign-out of confirmed accounts**
- [ ] That site's local data remains; the other confirmed, non-kept accounts are processed
- [ ] The status line mentions the kept site was skipped

### G. Triggers

- [ ] Set inactivity to 1 minute in settings, leave the machine alone, confirm it fires
- [ ] Lock the screen → unlock → configured high-risk local session data is cleared
- [ ] Close the browser entirely, reopen → any unfinished configured local cleanup is retried
- [ ] Restored tabs on cleared sites reload themselves rather than showing a stale
      signed-in page

### H. Failure behaviour

- [ ] Turn off networking and press **Attempt sign-out of confirmed accounts** — it should report
      failures honestly, not claim success
- [ ] Check the service worker console (`chrome://extensions` → *service worker*) for
      unhandled errors after each of the above
- [ ] In a disposable profile, interrupt a multi-site run. The popup must show the last
      checkpoint and unfinished domains, not a complete success
- [ ] Force a storage API failure in a test build. Cookie removal must not erase the failed
      site's startup retry entry; successful completion should retire it
- [ ] Remove site access. Cleanup must say it cannot verify the result, never infer success
      from an empty list returned without permission

### I. Recovery handoff (non-destructive)

- [ ] Open **Been hacked?**; essential accounts and trusted-device warnings are visible
- [ ] With the high-risk filter selected, save a text file and confirm a known low-risk
      confirmed account is included, while an unresolved candidate is absent
- [ ] Check a row as reviewed, then export again; every exported checkbox is still empty
- [ ] Open **Print / Save PDF** in installed Chrome. Inspect both A4 and Letter previews:
      only the portable plan should print, with no clipped domains or missing final rows
- [ ] Confirm the text/PDF has no cookie data, usernames, or security-page URLs
- [ ] Check the printed file includes essential guidance and the limitations at its end

## What to capture if something breaks

From `chrome://extensions`, click **service worker** to open its console, then include:

1. The console output, including any red errors
2. Which checklist item failed and what happened instead
3. The status text shown in the popup

The most useful failures are ones where **the extension claims more than it verified**.
Examples include calling a click a revocation, calling partial local cleanup complete, or
processing an unconfirmed account in the confirmed-only manual action.
