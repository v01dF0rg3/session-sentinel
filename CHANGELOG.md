# Changelog

## 0.15.0 — 31 August 2026

### The GitHub recipe is verified — by observation

Session count on the account went **5 to 4** after a run. Every previous cookie-only clear
had *increased* it. That is the first recipe in this project confirmed by measurement
rather than assumption, and it carries a `verified` date accordingly.

### Changed

- **An explicit logout now attempts a real sign-out on every site, not just high-risk
  ones.** youtube.com is `low` tier, so it never even tried, and was abandoned every single
  time. Without a server-side logout a session is not ended, only orphaned: still live,
  still listed, no longer visible to the user. That is worth a few seconds on any site
  someone deliberately clicked. Scheduled runs keep the tier threshold, since they are
  unattended and sweep many sites at once.

- **Recorded that GitHub demands identity verification to revoke a session**, and the
  guidance now says so before the user clicks through. It is also a third reason automating
  revoke-all was never realistic: an automated click cannot pass an email challenge.

### Tests

68.

## 0.14.0 — 31 August 2026

### End sessions instead of abandoning them

Deleting a site's cookies does not end its session — it orphans it, leaving a live token on
the server that the user can no longer see or revoke. Five clears of one GitHub account
produced five abandoned-but-active sessions. Reaching the site's own sign-out is the
difference between ending a session and littering.

- **GitHub recipe, rebuilt around the sign-out form** rather than the revoke-all button
  that does not exist. Navigates to `/logout`, waits for the form, submits it. A form
  submit is what carries the CSRF token the endpoint requires; a fetch cannot.

- **The generic fallback now tries `/logout` first**, then falls back to scanning the
  homepage. Most frameworks put a sign-out form at that path, and it is far cheaper than
  hunting a link that may be buried in a menu.

- **Results distinguish an ended session from an abandoned one.** *"This browser is signed
  out properly, not just cleared"* is a different situation from *"cleared here, but the
  session was not ended on the site, so it stays listed as active there"*, and the user
  should be able to tell which they got.

The GitHub recipe is verifiable in a way the deleted ones never were: sign out through the
extension, reload the sessions page, and see whether the count grows. It carries no
`verified` date until someone does exactly that.

### Tests

67.

## 0.13.2 — 30 August 2026

### Changed

- **Signing keys moved out of the repository** to `~/.session-sentinel/keys`
  (`SENTINEL_KEY_DIR` overrides). They were gitignored and verified excluded from every
  commit, but the repository is public now and a `.gitignore` entry is one `git add -f`
  away from failing. The key is the trust anchor for the entire update channel — anyone
  holding it can serve a bundle every installation will accept — so distance from the repo
  is worth more than a rule inside it.
- MIT licence added. Without one the code was legally all-rights-reserved and unusable by
  anyone else.

## 0.13.1 — 30 August 2026

### Added

- **Filter box on the settings site list**, matching the popup. With a couple of hundred
  signed-in sites the table was an endless scroll. It shows "N of M" while filtered, has an
  **Only configured** toggle for the handful of sites given custom handling, and the table
  now scrolls within a fixed height with a sticky header instead of running down the page.

### Changed

- A failed recipe update caused by there being no server reads as
  *"No recipe server is published yet, so there is nothing to download — the built-in
  recipes are in force and nothing is wrong"* rather than relaying `Failed to fetch`. The
  bare network error looked like a bug; it is just a feature with no backend yet.

## 0.13.0 — 30 August 2026

### Added — say what would actually work

Automated revoke-everywhere is impossible on sites that offer no such control, so the
result now says so per site and names what the user can do instead. Three distinct answers,
because they are genuinely different situations:

- **No bulk revoke** (GitHub, confirmed): *"This site has no 'sign out everywhere' button —
  sessions must be revoked one at a time from the list, or ended all at once by changing
  your password."* With a link to the list.
- **Has a session page, capability unchecked** (21 sites): *"Revoke them from the page below
  if it offers it; changing your password is the reliable fallback."*
- **No known session page**: *"Check its account security settings — and if there is nothing
  there, changing your password is usually the only thing that ends sessions elsewhere."*
  Hedged deliberately: absence from a 23-entry list is not proof a site has nothing.

Only GitHub is marked as confirmed-no-bulk-revoke, because it is the only one anybody has
looked at. Guessing the rest is what produced twelve broken recipes, and the mistake is not
worth repeating in a friendlier format.

### Tests

65.

## 0.12.0 — 30 August 2026

### Removed twelve recipes

GitHub's sessions page has **no bulk revoke control at all** — confirmed on desktop and
mobile. Sessions are revoked one at a time behind a "Details" expander. The recipe had been
clicking for a button that never existed.

Every other click-based recipe was written the same way: from a plausible guess about a page
nobody had looked at. The first one anybody checked was wrong in the worst possible way, so
the rest were removed rather than left to fail quietly.

A wrong recipe is worse than no recipe. It fails silently, **and** it pre-empts the generic
fallback that would otherwise find the site's real "Sign out" link and end the session
properly. Three recipes survive, all of which merely navigate to a documented logout URL:
Google, Amazon, Reddit.

### Added

- **"Review sessions" links.** Clearing cookies locally does not end a session on the
  site's side — it *orphans* it. The session stays listed as active and remains usable by
  anyone holding the token. Four clears produced four abandoned-but-live GitHub sessions.

  For the 23 sites known to expose a session list, the result now links straight to it, so
  the user can finish the job the extension cannot. A link that works beats automation that
  pretends.

- The result text now says "the site may still list the session as active" rather than
  implying local clearing was the end of it.

### Fixed

- A navigate-only recipe no longer trips the "clicked nothing" guard added in 0.11.0 —
  reaching a documented logout URL *is* the work.

### Tests

62.

## 0.11.0 — 30 August 2026

### Fixed — a false green

The GitHub recipe reported **revoked** — "sessions on your other devices are gone" — while
every session on the account was still live, confirmed on a phone minutes later. This is
the precise failure the whole codebase is built to prevent, and it shipped.

Three independent holes let it through:

1. **`assertAbsent` passed vacuously.** Its selector, `form[action*="revoke"] button[type="submit"]`,
   was never on the page at all, so asserting its absence was trivially true. An absence
   assertion means nothing unless the thing was present first. The runner now refuses to
   assert that something went away unless it saw it there earlier in the same recipe.

2. **Every click in the recipe was `optional`.** It could run to completion having clicked
   nothing. A `global` recipe must now contain a click that is allowed to fail the recipe
   — enforced in `isValidRecipe` — and the runner reports `none` if no click actually
   landed, whatever the steps did.

3. **Nothing tied the capability claim to evidence.** Recipes now carry an optional
   `verified` date, set only after someone has signed in on a second device, run the
   logout, and confirmed that device was signed out. An unverified `global` recipe is
   downgraded to a local claim at run time.

**No bundled recipe carries a `verified` date**, so none can report `revoked` today. That
is the honest state: fifteen recipes whose URLs resolve and whose behaviour has never been
confirmed against a real account.

- The GitHub recipe's selectors and structure were rewritten, its decisive click made
  non-optional, and its capability claim left unverified.

### Tests

60, including six new ones that reproduce this failure directly — asserting absence of the
never-present, a recipe that clicks nothing, and the verified/unverified downgrade.

## 0.10.0 — 30 August 2026

### Changed

- **Open tabs are reloaded after a site is cleared, by default.** Confirmed working in real
  use: the logout succeeded but YouTube carried on showing a signed-in avatar until the
  page was refreshed. The session was gone; the page just had not noticed. A security tool
  that looks like it failed is one people stop trusting, so making the result visible is
  part of doing the job rather than a nicety.

  Safe now in a way it was not two versions ago: the crash came from forcing tabs to
  `about:blank`, which no longer exists anywhere in the codebase. `tabs.reload` is the same
  operation as pressing F5.

  Turn it off in Settings → Your open tabs. Worth knowing that reloading discards anything
  typed into a form on that site — the settings copy says so.

- Settings migration to v3 applies the new default to existing installs, since a stored
  value always wins over a changed default.

## 0.9.0 — 30 August 2026

Chrome no longer closes — tab manipulation was the cause, confirmed by removing it.
YouTube then failed to log out, which exposed a real bug that had been hidden behind the
crash.

### Fixed

- **Federated sign-ins are now cleared as a group.** Clearing `youtube.com` on its own
  never logged anyone out: `accounts.google.com` re-issues YouTube's cookies from the
  still-live Google session on the next visit. The same holds for Instagram behind
  Facebook, and Outlook behind Microsoft.

  A logout now expands to cover the siblings the user is **actually signed into** —
  restricted to domains with cookies in the profile, so a one-site logout does not
  suddenly list a dozen Google properties nobody uses. The report says which sites came
  along and why.

  Shared ownership is deliberately not shared sign-in: Amazon owns Twitch, but an Amazon
  session does not restore a Twitch one, and grouping them would sign people out of things
  they never asked about.

- **A kept sibling is now reported.** Marking `google.com` as never-clear while logging out
  of YouTube means Google signs YouTube straight back in. The result says so rather than
  claiming success.

- **Open tabs are explained.** A page already open keeps its session in memory and looks
  signed in until reloaded, which reads as "the logout did not work". The result now says
  how many tabs are still open and that reloading will show the change. Counting tabs is
  read-only and always safe; only reloading them is opt-in.

### Tests

49, including six for the sign-in groups.

## 0.8.0 — 30 August 2026

Fourth crash. Notifications were already off, so that bet was wrong, and no crash banner
appeared — which was itself the most useful thing to learn.

### Fixed

- **The instrumentation was erasing its own evidence.** The breadcrumb was cleared when a
  run finished, and these runs *do* finish: the user is logged out afterwards. So the
  browser was dying at or after the end of a successful run, with nothing left to show for
  it. Replaced with a **permanent activity log** — every step, every run boundary, and
  browser lifecycle events, capped at 200 entries, never cleared automatically. The
  question "did it die mid-step or after completing?" now has an answer sitting in storage.
  Viewable and copyable from the diagnostics page.

- **The extension no longer touches your tabs by default.** Tab manipulation is the last
  remaining suspect: the previous versions navigated open tabs to `about:blank` before
  clearing, and abruptly tearing down a page — a YouTube tab mid-playback, say — is exactly
  the kind of thing that can take a browser process down with it.

  This follows the pattern of the last two fixes: the crash stopped mattering each time a
  capability was removed rather than guarded. Windows went first, now tabs.

  The cost is honest and stated in the settings: a page you already have open may keep
  working until you reload it, because it still holds its session in memory. Reloading is
  offered as an opt-in setting (`reload` is far gentler than a forced navigation), but it
  is off by default until the crash is understood.

### Added

- Activity log viewer in diagnostics, with copy and clear.
- `Your open tabs` setting.

## 0.7.0 — 30 August 2026

### Diagnosis, not another guess

Chrome quit a third time, on a per-site logout of youtube.com. That ruled out both
previous theories: youtube is a *low* tier site, so no work tab is created for it and no
window is involved. Only tab parking, a cookie wipe, and tab restoration ran.

Two wrong guesses is enough. This release stops reasoning about it and instruments it.

- **Crash breadcrumbs.** Before each risky call the engine writes what it is about to do
  to `chrome.storage.local`, and clears it on a clean finish. Storage survives the browser
  dying, so a breadcrumb still present at the next start names the exact call that was in
  flight, and the site it was working on. The popup shows it in a red banner.
  Deliberately not `storage.session`, which is wiped by the very event under investigation.

- **Notifications default to off**, with a migration so existing installs get the change.
  The reported screenshot showed the run had *completed and saved its report* before the
  browser died — and the notification is the last thing a run does, which makes it the
  prime suspect. It is cosmetic, so removing it from the path costs almost nothing while
  the breadcrumb confirms or clears it. Re-enable freely in settings.

### Added

- **Site filter in the popup.** With 218 signed-in sites the list was unusable. Appears
  once there are eight or more sites; the count still reports the full total.

## 0.6.0 — 30 August 2026

### Fixed — critical (again)

- **Logging out still quit Chrome**, even after 0.5.1 stopped closing tabs. The logout
  itself worked; the browser died anyway.

  0.5.1 fixed the tab-closing half and left the window half in place, guarded. That was the
  wrong call. An extension cannot reliably reason about the browser's window count, Chrome
  exits the moment that count hits zero, and every guard around `windows.remove()` was a
  patch on a risk that did not need to exist at all.

  **The extension no longer creates or removes windows.** Server-side logout now runs in a
  background tab inside a window the user already has open. If there is no such window, it
  is skipped and reported as skipped, rather than conjuring one that would later have to be
  disposed of. Exactly one `tabs.remove` call remains in the codebase, inside a helper that
  refuses to close the last tab of the last window, and every caller goes through it.

  Honest limitation: I could not reproduce the exact mechanism by which removing the hidden
  window ended the session — that would need the failing environment. Removing the
  capability makes the mechanism irrelevant, which is a better outcome than a guard I would
  still be unsure of.

### Changed

- Server-side logout opens its work tab in the current window, so a tab now appears and
  disappears in the tab strip during a run. That visible artefact is the deliberate price
  of never touching window lifetime.
- Diagnostics reports which window will be borrowed and asserts the window count does not
  change.

### Tests

`tests/tabs.test.mjs` now asserts the structural invariant directly: `windows.create` and
`windows.remove` are replaced with fakes that throw, and the whole tab path runs against
them. 43 tests.

## 0.5.1 — 30 August 2026

### Fixed — critical

- **"Log out of all sessions" could quit Chrome.** Reported from real use on the first
  try, which is exactly what a manual smoke test is for.

  Before wiping a site, the engine closed the user's tabs on it, so a live single-page app
  could not write its tokens back into localStorage after the wipe. That reasoning was
  sound; closing tabs to achieve it was not. "Log out of all sessions" iterates over every
  signed-in site, so it closed every tab, which closed every window — and a browser with no
  windows quits. The extension's own hidden work window closing straight afterwards made it
  certain.

  Tabs are now **parked on `about:blank` and sent back afterwards**. That destroys the page
  context just as effectively, and the tab, the window, and the browser all survive. The
  user ends up looking at the same site, signed out.

- **Two further paths to the same outcome**, closed at the same time:
  - `closeWorkWindow` now empties the hidden window instead of removing it when it is the
    only one left.
  - `closeTab` refuses to close the last tab of the last window anywhere in the codebase,
    blanking it instead. The guard lives in the helper rather than at each call site so it
    cannot be forgotten later.

### Added

- **`tests/tabs.test.mjs`** — nine tests against a fake `chrome` global.

  The deeper problem was that `platform/` had no coverage at all, on the reasoning that it
  touches `chrome.*` and therefore needs a browser. A fake global costs very little and
  would have caught this before it ever ran. One test reproduces the exact original shape —
  every open tab belonging to a targeted site — and asserts the browser survives.

## 0.5.0 — 30 August 2026

### Added

- **Diagnostics page.** Fourteen checks that run the extension's real code against the real
  browser APIs and report what works, reachable from Settings → Check it works.

  It exists because of an honest gap: `core/` is covered by node tests and the injected page
  logic by browser tests, but `chrome.cookies`, `chrome.browsingData`, and window creation
  only exist inside an installed extension. Everything about that layer was reasoned from
  API contracts rather than observed. This turns it into something a user can verify in one
  click before trusting the extension with a real account.

  Safety: cookies are counted, never read or displayed, so a pasted report cannot carry
  session material. The only destructive check targets `session-sentinel-selftest.invalid`,
  a reserved TLD that cannot resolve. Any check that cannot run reports "skipped" with a
  reason, never a false pass.

## 0.4.0 — 30 August 2026

Signed recipe update channel. Built and tested end to end; ships **switched off**, because
no bundle host is live yet and a feature that silently fails its weekly check is worse than
one honestly disabled.

### Added

- **Signed recipe bundles** (`src/core/bundle.js`, `src/platform/recipe-store.js`). ECDSA
  P-256 with the key pinned in the extension. Five rules, in order: size cap before
  parsing; signature verified before the payload is treated as anything; version may not go
  backwards; every recipe re-validated individually against the navigation trust policy;
  and any failure leaves the built-in recipes in force.
- `dev/sign-bundle.mjs` — keygen and signing tool. Private keys live in a gitignored
  `dev/keys/`.
- Settings section showing how many recipes are in force, where they came from, and the
  last update error if there was one.

### Security notes

- **Rollback is treated as an attack.** An old bundle keeps a genuine signature forever, so
  version monotonicity is enforced separately from authorship.
- **A signature proves authorship, not correctness.** Recipes from a correctly signed
  bundle still go through the same navigation trust policy as built-in ones, so even a
  compromised signing key cannot point the engine at an attacker's page. Covered by a test.
- **The whole list is fetched at once, never queried per domain.** An endpoint answering
  "what is the recipe for chase.com?" would leak exactly what this extension protects. The
  request carries no cookies and no referrer.
- ECDSA P-256 rather than Ed25519: Ed25519 only reached WebCrypto in recent Chrome, and an
  extension that cannot verify its own updates on an older browser is worse than one using
  a slightly older curve.

### Tests

34 node tests (11 new, signing real payloads with real keys and then attacking them),
15 browser tests.

## 0.3.0 — 30 August 2026

Security hardening and first-run safety. Not yet released; the manual smoke test in
[TESTING.md](TESTING.md) is the remaining gate.

### Security

- **Navigation is now confined to trusted destinations.** A site's OIDC discovery document
  names where to go to log out — and that document is served by the site being logged out.
  A hostile site could name any URL, and the engine would navigate a background tab there
  (carrying the user's cookies) and click controls matching "confirm". Destinations are now
  restricted to the target site itself or a short allowlist of identity providers, checked
  both before navigating and again after landing, since a trusted endpoint can redirect.
- **Recipes can no longer navigate off-site.** Enforced in `isValidRecipe`, which matters
  most for the planned remote recipe bundle: a recipe able to navigate anywhere and click
  "confirm" is a far more dangerous object than one confined to its own site.
- Explicit `content_security_policy` in the manifest.

### Added

- **First-run setup page.** `onboarded` starts false and the planner refuses every
  automatic trigger until it is acknowledged, so a fresh install cannot silently sign
  someone out of their bank at the first browser close. The page lists the sites that
  would actually be affected, read from the real cookie jar, and lets the user exempt any
  of them before anything runs. "Manual only" is offered for people who want the button
  without the automation.
- `PRIVACY.md`, `TESTING.md`, `STORE.md` — privacy policy, the three-layer test plan, and
  Web Store submission notes with per-permission justifications.
- Seven more logout recipes: GitLab, Microsoft, Netflix, Spotify, Twitch, Zoom, Instagram.
  Fifteen in total.

### Fixed

- **Partial wipes reported as complete.** `browsingData.remove()` with several data types
  is all-or-nothing; the previous code caught the rejection, deleted cookies as a fallback,
  and returned success — so a "deep" wipe could silently degrade to cookies only. It now
  retries type by type and the report names what survived.
- **Clicks on hidden decoy controls reported as success.** `clickText` would click an
  element hidden with the standard screen-reader pattern (`width:0;height:0;overflow:hidden`)
  and report `ok`. Padding gives such an element a non-zero box and its computed width
  reads as the padded value, so no CSS check rules it out. The runner now prefers the
  innermost, largest, hit-testable candidate and refuses to click anything under an overlay.
- Work-window creation failure is now reported explicitly instead of being left to infer
  from a column of amber results. The risky `state` flag is applied after creation, so its
  rejection costs a visible window rather than every server-side logout in the run.
- Restored tabs on cleared sites are reloaded — session restore races the startup wipe, and
  a tab that looks signed in over a dead session is worse than one showing logged out.
- `windows.onRemoved` no longer mistakes the run's own hidden work window closing for the
  browser shutting down, which could start a second wipe competing with a live run.
- Session-cookie detection missed `sessionid`, `PHPSESSID`, and `JSESSIONID` because it
  required separator boundaries.

### Design

- **New icon**, matching the supplied artwork: near-black rounded tile, white disc, black
  padlock. Generated from source by `npm run icons`, so the artwork is reproducible rather
  than a binary nobody can regenerate. The 16px size is hinted separately — the keyhole is
  under two pixels there and only muddies the silhouette, so it is dropped and the lock
  enlarged slightly.
- **In-app marks are drawn as an inline SVG glyph in `currentColor`**, not the app tile.
  The tile is a dark square, which disappears against a dark popup background; the glyph
  adapts to the theme and stays sharp at any size. Tiles are for the toolbar and the store.

### Changed

- "Never clear this site" is now a persistent, plainly-labelled checkbox on the current
  site and every row, instead of a hover-revealed button labelled "Ignore". A protection
  the user cannot see is a protection they do not know they have.
- Keyboard focus rings on all interactive elements; the status region announces results to
  screen readers; empty states are explicit.

### Tests

23 node tests, 15 browser tests.

## 0.1.0

Initial scaffold: tiers 0, 1, 3 and 4 working end to end, eight recipes, risk
classification, the four triggers, popup and options.
