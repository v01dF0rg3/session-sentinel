# Testing

Four layers. The first two are automated; the last two need a real browser, because the
`chrome.*` APIs cannot run anywhere else.

## 1. Decision logic (node)

```bash
npm test
```

23 tests over the pure logic: risk classification, domain parsing, the planner that
decides what gets destroyed, and the navigation trust policy. No `chrome.*` calls, so it
runs anywhere. **This is the layer where a bug silently wipes data the user asked us to
keep**, which is why it has the most coverage.

## 2. Injected page logic (browser)

```bash
node dev/server.mjs 5599
```

Open `http://localhost:5599/dev/step-runner.test.html`. 15 assertions run on load, PASS or
FAIL inline. These cover `pageStep` — the function injected into real pages — against the
hiding patterns sites actually use. Every one of them exists because a naive
implementation reports success for a click that never landed.

The same server hosts UI previews with a stubbed `chrome.*` API:

- `/dev/popup-preview.html`
- `/dev/options-preview.html`
- `/dev/welcome-preview.html`

## 3. Built-in diagnostics (in Chrome, one click)

Settings → **Check it works** → **Run diagnostics**, or open
`chrome-extension://<id>/src/ui/diagnostics.html` directly.

This runs the extension's real code against the real browser APIs and reports what works.
It is safe: it counts cookies without reading or deleting them, and the only data it clears
belongs to `session-sentinel-selftest.invalid` — a reserved TLD that cannot resolve or hold
anything.

Fourteen checks, covering permissions, storage, idle detection, alarms, cookie enumeration,
per-type data clearing, the full wipe routine, the hidden background window, script
injection into a real page, recipes, notifications, and current-site detection.

**Run this first.** It is the fastest way to find out whether the browser-facing layer
behaves on your machine, and "Copy report" produces text you can paste back for diagnosis.

Two results deserve attention even when the overall run passes:

- *Per-type data clearing* failing for a data type means deep wipes will clear less than
  the name suggests. The engine reports that per site rather than hiding it, but it is
  better known up front.
- *Hidden background window* reporting a state other than `minimized` means server-side
  logout still works, but a window may flash on screen while it runs.

## 4. Extension smoke test (manual)

**Use a separate Chrome profile.** On your normal profile this will genuinely sign you out
of things, and the automatic triggers fire on their own.

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

- [ ] Popup lists the sites you are signed into, and does not list obvious junk
- [ ] **Clear data** on the low-risk site → reload it → you are signed out
- [ ] The other site is still signed in (origin scoping works)
- [ ] Run it again on a site with no cookies — reports cleanly, does not error

### C. Server-side logout (Tiers 1, 3, 4)

- [ ] Per-site **Log out** on a site with a recipe (GitHub is the best test)
- [ ] A window appears minimized and closes again within ~20 seconds
- [ ] Result says **revoked**, not just cleared — check the popup status line
- [ ] On a site with no recipe, the result honestly says *cleared locally*

### D. Keep-site guarantee

- [ ] Tick **Never clear this site** on one site
- [ ] Press **Log out of all sessions**
- [ ] That site is still signed in; the others are not
- [ ] The status line mentions the kept site was skipped

### E. Triggers

- [ ] Set inactivity to 1 minute in settings, leave the machine alone, confirm it fires
- [ ] Lock the screen → unlock → high-risk sites are signed out
- [ ] Close the browser entirely, reopen → high-risk sites are signed out
- [ ] Restored tabs on cleared sites reload themselves rather than showing a stale
      signed-in page

### F. Failure behaviour

- [ ] Turn off networking and press **Log out of all sessions** — it should report
      failures honestly, not claim success
- [ ] Check the service worker console (`chrome://extensions` → *service worker*) for
      unhandled errors after each of the above

## What to capture if something breaks

From `chrome://extensions`, click **service worker** to open its console, then include:

1. The console output, including any red errors
2. Which checklist item failed and what happened instead
3. The status text shown in the popup

The most useful failures are ones where **the extension reported success but nothing
happened** — that is the failure mode this codebase is built to prevent, and any instance
of it is a bug worth stopping for.
