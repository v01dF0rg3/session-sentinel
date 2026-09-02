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

## 2. Injected page logic (browser)

```bash
node dev/server.mjs 5599
```

Open `http://localhost:5599/dev/step-runner.test.html`. 15 assertions run on load, PASS or
FAIL inline. These cover `pageStep` — the function injected into real pages — against the
hiding patterns sites actually use. Every one of them exists because a naive
implementation reports success for a click that never landed.

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

## 3. Built-in diagnostics (in Chrome, one click)

Settings → **Check it works** → **Run diagnostics**, or open
`chrome-extension://<id>/src/ui/diagnostics.html` directly.

This runs the extension's real code against the real browser APIs and reports what works.
It is safe: it counts cookies without reading or deleting them, and the only data it clears
belongs to `session-sentinel-selftest.invalid` — a reserved TLD that cannot resolve or hold
anything.

Fourteen checks, covering permissions, storage, idle detection, alarms, cookie enumeration,
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

### C. Website sign-out attempt (Tiers 1, 3, 4)

- [ ] Per-site **Attempt sign-out** on a site with a recipe
- [ ] Work happens in a background tab inside an existing window; no window is created or closed
- [ ] A reached route/control says **sign-out attempted**, not **revoked**
- [ ] A site where no sign-out control is reached honestly says **cleared locally**
- [ ] To validate real invalidation for a specific site, use a throwaway account on a second
      device and test whether its existing session stops working. Do not infer this from the
      extension's local browser state.

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

## What to capture if something breaks

From `chrome://extensions`, click **service worker** to open its console, then include:

1. The console output, including any red errors
2. Which checklist item failed and what happened instead
3. The status text shown in the popup

The most useful failures are ones where **the extension claims more than it verified**.
Examples include calling a click a revocation, calling partial local cleanup complete, or
processing an unconfirmed account in the confirmed-only manual action.
