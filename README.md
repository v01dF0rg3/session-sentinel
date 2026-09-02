# Session Sentinel

[![tests](https://github.com/v01dF0rg3/session-sentinel/actions/workflows/test.yml/badge.svg)](https://github.com/v01dF0rg3/session-sentinel/actions/workflows/test.yml)

A Manifest V3 Chrome extension that ends your web sessions — on demand, after inactivity,
when the screen locks, or when the browser closes.

It works out of the box. Install it, accept the permission prompt, and it protects your
high-risk accounts with no configuration.

## Which sites it shows you

The cookie jar knows every domain that has ever set an auth-looking cookie. On a real
profile that is a couple of hundred, and almost none of them are accounts you have.

So two questions are kept apart, deliberately:

- **What should be cleared?** Answered generously. Missing a session cookie leaves a live
  token behind, so anything that might carry one is in scope.
- **What should be shown?** A session cookie is not evidence of an account: fetched with no
  cookies at all, bloomberg.com hands a stranger `_session_id_backup` — httpOnly, Secure,
  opaque. So a cookie counts only if it *arrived after this extension first saw the site*.
  An anonymous session cookie is issued on first contact and then sits there; an
  authenticated one may appear—or the site may upgrade the same opaque session—when you
  sign in.

  Sites you were already signed into before installing cannot be separated that way, and no
  rule over cookie names can do it either. Those rows sit behind **Log in to pre-existing
  accounts**. **Login** opens the site and activates its own sign-in route. If the site
  already shows an authenticated account—or after the login completes—it moves into
  Confirmed accounts automatically. Every unresolved site stays out. **Not mine** remains
  optional queue cleanup.

Being open in a tab, or high in your top sites, orders confirmed accounts but never joins
that set — a sign-in page is maximum evidence of attention and zero evidence of an account.
The recovery checklist consumes the same confirmed set, so turning on visit-frequency
ordering cannot promote Bloomberg, eBay, or any other unanswered site into an account.

If a site is listed that is not yours, **Settings → Check it works → Why these sites are
listed** names the exact cookie that caused it.

Unanswered candidates and cleanup-only sites have separate disclosures. A site explicitly
marked Keep remains visible in its own section so that choice can be reversed, but Keep is
not treated as proof of authentication. The total stays on screen and the filter still
searches all of it, but **Log out of confirmed accounts** acts only on the confirmed set.
Scheduled safety wipes retain their deliberately generous cookie-candidate scope.

There is no Bloomberg rule or domain deny-list in this decision. The same invariant applies
to every domain: an anonymous-looking or otherwise unresolved cookie candidate cannot enter
Confirmed accounts or recovery merely because the site is open or frequently visited.

The answer is re-derived from the cookie jar every time the list is read, never cached. An
earlier version remembered its own verdicts and made its own mistakes permanent — a site
judged signed in under a rule later found wrong stayed listed regardless. Cleanup history is
not account evidence either: a broad run also acts on false positives, so remembering that
action would preserve the same guess under another name.

This is not `chrome.history`: history tells you what pages you opened, which cannot
distinguish a news article from an inbox, and is a great deal to ask for to answer a
question about domains.

## What it cannot do, stated up front

It cannot make a website revoke your other sessions. Nothing installed in a browser can.

An extension may only do what a person at the keyboard may do, and "sign out everywhere"
is a button most sites simply have not built. The mechanisms that could change that —
[Shared Signals / RISC](https://openid.net/wg/sse/), CAEP, device-bound session
credentials — are either server-to-server or live inside the browser itself. There is no
protocol by which a site grants an extension that power, and inventing one would mean
shipping a spec no site implements.

So the promise is a ladder, not a guarantee. The extension climbs as high as each site
allows and then tells you which rung it reached:

| Rung | What happened | How often |
| --- | --- | --- |
| 1. Cleared | Session material destroyed on this device | Always |
| 2. Signed out | The site's own sign-out ran, ending the session server-side | Often |
| 3. Revoked | Every session, everywhere, ended | Only where the site offers it |

A result is never reported stronger than the evidence for it. Clearing cookies without
reaching rung 2 *orphans* a session rather than ending it: the token stays alive and
listed on the site, you just can no longer see it. The report says so in those words.

### When rung 3 is missing

On most stacks, **changing your password is the revocation** — it is what invalidates
sessions on devices you no longer hold. It is the only universal primitive that actually
exists, so it is what the "Been hacked?" walkthrough is built around.

Finding that page used to depend on a hand-written table of two dozen domains. It now also
uses [`/.well-known/change-password`](https://w3c.github.io/webappsec-change-password-url/),
a deployed convention that lets a site point at its own password page. Measured against 30
popular domains: **11 serve it**, 14 return a clean 404, and 5 answer `200` for URLs that
cannot exist — those last are refused rather than guessed at, because sending you to a
soft-404 page during a break-in is worse than admitting we do not know.

That is not most of the web. It is a third of it, for free, on top of the curated list —
and the honest framing is that the remainder still needs you to find the security settings
yourself, which the walkthrough will say rather than pretend otherwise.

## Loading it

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder

No build step. The source is plain ES modules and loads as-is.

A setup page opens on first install. **Until you finish it, no automatic trigger will
fire** — not on browser close, not on idle, not on screen lock. It shows the sites that
would actually be affected, read from your real cookies, and lets you exempt any of them
before anything runs. Manual logout works immediately; the gate is about surprise, not
about withholding the feature.

## What it actually does

"Log out of confirmed accounts" can produce three different results, and the extension
distinguishes them in every report rather than painting everything green:

| Result | Meaning |
|---|---|
| **revoked** | The site confirmed it killed sessions on your other devices too. Only claimed by recipes whose behaviour has been verified on a second device — **none are, yet** |
| **signed out** | This browser's session was ended server-side; other devices unknown |
| **cleared locally** | Cookies and storage deleted here. A token stolen earlier may still work elsewhere |
| **failed** | Could not do even that |

A partial result says so: if a deep wipe cleared cookies but Chrome refused to clear
IndexedDB, the report names what survived instead of reporting a clean sweep.

Deleting cookies defeats *local* session hijacking — malware or another user reading your
cookie jar. It does nothing about a token already exfiltrated to an attacker's machine.
Only the first two rows do that, and only where the site provides the means.

## How server-side logout works

Replaying a captured logout request does not work: CSRF tokens rotate, and a `fetch()`
from the extension origin is cross-site, so `SameSite` cookies are never attached.

Instead the extension opens a **background tab on the site's own origin** and drives
the site's own controls. A click inside the page carries the live CSRF token, the right
`Origin`/`Referer`, and every cookie. Four tiers are tried in order:

1. **Curated recipe** — for sites with a documented logout URL (`src/core/recipes.js`).
   Deliberately only three: recipes that clicked at "sign out everywhere" buttons were all
   removed after the first one checked turned out to be clicking for a control that does
   not exist
2. **OIDC RP-initiated logout** — discovered from `/.well-known/openid-configuration`;
   generic coverage for anything behind Okta, Entra, Auth0, and friends
3. **Heuristic** — find and click whatever reads as a logout control
4. **Local destruction** — always runs, whatever happened above

Recipes are **data, never code**. The interpreter ships inside the extension and nothing is
`eval`'d, so the recipe table can later be fetched as a signed remote bundle without
breaking the Web Store's remote-code rule.

## Defaults

| Trigger | Default |
|---|---|
| Browser closes | On, for high and critical sites |
| Inactivity | On, 30 min, critical sites |
| Screen lock / sleep | On, for high and critical sites |
| Contact sites to revoke | On, for high and critical sites |

Risk tiers are assigned automatically from a bundled classification plus keyword and TLD
heuristics, so an unlisted bank still lands in the right tier.

Deep wipes (which include IndexedDB and cache storage) are reserved for critical sites.
Many web apps keep drafts and offline documents in IndexedDB, and a zero-config extension
that destroys those on every site at browser close would lose someone's work on day one.

## If the browser closes during a run

Open **Settings → Check it works → Run diagnostics** and look at the **Activity log** at
the bottom. It records every step of every run and survives browser restarts, so it shows
exactly where things got to. The key thing to look for is whether `run:complete` appears
before the next `browser:startup` — that separates "died mid-step" from "finished, and the
browser went away anyway". **Copy log** puts it on the clipboard.

Open tabs on a cleared site are reloaded automatically, so the signed-out state is visible
straight away. Turn that off in Settings → Your open tabs if you would rather refresh pages
yourself.

## Coverage

Settings → **Check it works** → **Coverage** reports how often the extension reaches a
site's real sign-out rather than only deleting cookies. It counts results as you use it and
names the sites where nothing worked — those are the ones worth a recipe, chosen by
evidence rather than intuition.

Only sites where a server-side logout was actually attempted count towards the rate.

## Checking it works

Settings → **Check it works** → **Run diagnostics**. Fourteen checks that run the real code
against the real browser APIs and report what works on your machine, with a **Copy report**
button for sharing the results.

Safe to run at any time: it counts your cookies without reading or deleting them, and the
only data it clears belongs to a reserved test domain that cannot exist.

The same page also contains a separate, explicit **Private-store account check**.
That is not part of the fourteen checks: it contacts only the domain you enter, once, in a
fresh blank Incognito store and compares cookie names with the normal profile. It refuses
to run if the private jar is not empty and never exposes cookie values. It is diagnostic:
matching names prove the name is ambiguous, but not that the normal session is logged out,
because a site may reuse one cookie name on both sides of sign-in. It saves no verdict and
does not change the list. Close every Incognito window after a probe to erase its temporary
site data.

## What clearing cookies does not do

Deleting a site's cookies does not end your session on the site's side. It **orphans** it:
the session stays listed as active, and remains usable by anyone who already holds the
token. Clear GitHub four times and GitHub will show you four abandoned-but-live sessions.

So after every run the result says, per site, what would actually end those sessions:

- Sites with **no bulk revoke at all** — GitHub is a confirmed example — say so plainly, and
  point out that revoking one at a time or changing your password are the only options.
- Sites with a **session page** get a direct link to it.
- Sites with **nothing known** are told the truth: check the security settings, and a
  password change is usually the only thing that ends sessions elsewhere.

No extension can revoke a session on a site that provides no way to do it. Saying which
sites those are is the next most useful thing.

## If you have been compromised

The popup's **Been hacked?** link opens an ordered walkthrough of every account worth
securing, grouped by blast radius rather than by risk score. Email and identity providers
come first — every other account can be reset through them, so anything fixed before those
can simply be taken again. Then money, then infrastructure, then social.

It links straight to each password page where one is known, notes where one password change
covers several accounts, and keeps your place across browser restarts. Nothing on that page
logs you out of anything: if someone else holds a live session, logging yourself out
surrenders the session you control and leaves theirs running.

## Sites that share a sign-in

Some sites cannot be logged out on their own. YouTube's session is issued by Google, so
clearing YouTube alone achieves nothing — the next visit gets a fresh session from the
Google login that is still active. Instagram sits behind Facebook the same way, and Outlook
behind Microsoft.

Session Sentinel clears these as a group, limited to the sites you are actually signed into,
and tells you which ones came along. If you have marked one of them **never clear**, it says
so, because that site will sign the others back in.

## Keeping a site signed in

Some sites you never want logged out — YouTube, a music player, a home dashboard. Tick
**Never clear this site** in the popup (it sits right under the current site's name) and
that site is skipped by every automatic trigger *and* by **Log out of confirmed accounts**.
The big button deliberately does not override it.

Each row in the signed-in list has the same control as a **Keep** checkbox, and the options
page exposes it as the *never clear* handling mode. Kept sites are counted in the popup so
you can see at a glance what the next run will leave alone.

You can still clear a kept site deliberately — the per-site **Log out** and **Clear data**
buttons always work. Keeping a site protects it from automation, not from you.

## Privacy

- No account, no telemetry, no analytics, no network destination for anything it observes
- All state in `chrome.storage.local`
- The site list is derived from your own cookie jar and never leaves the machine

`<all_urls>` is requested at install because the alternative — per-site permission grants —
means the extension silently does nothing on sites you never approved, which is a worse
security outcome than a single honest prompt.

## Tests

Two suites, because the risky code splits in two.

**Decision logic** — risk classification, domain parsing, the planner that decides what
gets destroyed, and the navigation trust policy. No `chrome.*` calls, so it runs in plain
node:

```bash
npm test
```

**Injected page logic** — `pageStep`, the function that runs inside real pages and does the
clicking. It needs a DOM, so it runs in a browser:

```bash
node dev/server.mjs 5599
```

Then open `http://localhost:5599/dev/step-runner.test.html` — 15 assertions, PASS/FAIL
inline. These exist because of a real bug: an early version clicked a decoy button hidden
with the standard screen-reader pattern (`width:0;height:0;overflow:hidden`) and reported
success. Padding gives such an element a non-zero box, so no CSS check rules it out
reliably. The runner now prefers the innermost, largest, hit-testable match, and refuses to
click anything sitting under an overlay.

The same server hosts UI previews with a stubbed `chrome.*` API:
`dev/popup-preview.html` and `dev/options-preview.html`.

## Layout

```
src/core/       pure logic - no chrome.* anywhere, unit-testable in node
src/platform/   the only place chrome.* is touched
src/engine/     orchestration: tier selection, execution, verification, reporting
src/background/ event wiring (triggers)
src/ui/         popup and options
data/           bundled risk classification
```

The rule that keeps this extensible: `core/` never imports `chrome`. A future Firefox
target, or a second security module, plugs in behind `platform/` without a rewrite.

## Icons

```bash
npm run icons
```

Regenerates all four sizes from [dev/make-icons.mjs](dev/make-icons.mjs), a dependency-free
PNG encoder. The artwork is defined in normalised coordinates so every size matches, and
the 16px favicon is hinted separately for legibility.

## Signing keys

The recipe bundle signing key lives **outside this repository**, at
`~/.session-sentinel/keys` by default (override with `SENTINEL_KEY_DIR`). A `.gitignore`
entry is one `git add -f` away from failing and this repo is public; the key is the trust
anchor for the whole update channel, so distance beats a rule.

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design rationale, the constraints behind each decision, roadmap |
| [TESTING.md](TESTING.md) | All three test layers, including the manual smoke test |
| [PRIVACY.md](PRIVACY.md) | Privacy policy |
| [STORE.md](STORE.md) | Web Store submission notes and permission justifications |
| [CHANGELOG.md](CHANGELOG.md) | What changed and why |

## Security posture

Three inputs to this extension are attacker-influenced, and all are constrained:

- **A site's OIDC discovery document** names where to go to log out — and is served by the
  site being logged out. Navigation is restricted to the target site or a short allowlist
  of identity providers, checked before navigating and again after landing, because a
  trusted endpoint can redirect.
- **Recipes** cannot navigate off the site they claim to log out of — including recipes
  from a correctly signed remote bundle. A signature proves authorship, not correctness.
- **The update channel** verifies an ECDSA P-256 signature against a pinned key before the
  payload is treated as anything, refuses version rollbacks, re-validates every recipe, and
  fails closed to the recipes that shipped in the extension.

Covered by [tests/trust.test.mjs](tests/trust.test.mjs) and
[tests/bundle.test.mjs](tests/bundle.test.mjs), which sign real payloads with real keys and
then attack them.

Recipe updates are **off by default** and fetch the whole list in one request — never
queried per domain, because such a request would leak which sites you use.
