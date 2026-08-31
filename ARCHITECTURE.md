# Architecture

Design rationale for Session Sentinel, and the constraints that produced it.

## The problem

"Log out of all sessions" is three operations wearing one name:

| | What it does | Feasibility |
|---|---|---|
| **A. Local session destruction** | Delete cookies + storage for an origin on this machine | 100% reliable, needs no site cooperation |
| **B. Site logout** | Drive the site's own logout so the server invalidates this token | Reliable *if* driven through a real tab |
| **C. Global revocation** | Kill the session on the user's phone and other laptops | Per-site only, frequently behind re-auth |

Most extensions in this space deliver A and let the user believe it is C. That is a
security lie: the user stops worrying about a session that is still live. Every result in
this codebase is reported at the weakest claim the evidence supports
(`src/engine/report.js`).

## Why captured requests do not work

The obvious design — record the logout POST once, replay it later — fails on second use:

- **CSRF tokens** are session-bound and rotate per page load
- **`SameSite=Lax/Strict`** cookies are not attached to a request from the extension
  origin, because `chrome-extension://…` is a different site. The replay arrives
  unauthenticated.
- Origin/Referer checks, custom headers, and double-submit cookies add further binding

So the unit of automation is not an HTTP request. It is a short **recipe of
navigate/click/wait steps executed in a real background tab on the site's own origin**,
where all of that context exists for free. This single decision shapes everything else:
it is why `src/platform/tabs.js` exists, why the interpreter loop lives in the service
worker rather than the page, and why the extension can honestly claim `revoked` at all.

## Execution model

The interpreter loop runs in the **service worker**, not the page
(`src/engine/logout.js` drives, `src/engine/step-runner.js` executes one step). Any step
can trigger a navigation that destroys the page's execution context; a loop running there
would simply vanish mid-recipe. So: SW issues one step → page returns a result → SW decides
the next step.

`step-runner.js` is injected via `chrome.scripting.executeScript({ func })`, which
serialises the function with `toString()`. It must therefore be entirely self-contained —
no imports, no closure over module scope.

### Picking the right element to click

The hardest correctness problem in the whole extension, and the source of its first real
bug. Sites ship accessible duplicates of their controls hidden with `sr-only` patterns —
`width:0;height:0;overflow:hidden`, clip rects, `left:-9999px`. Padding gives those a
non-zero border box, and their computed width can read as the padded value rather than
zero, so **no CSS property check rules them out reliably**. An early version clicked one,
reported `ok: true`, and left the real control untouched.

The runner now, in order: rejects `display:none` / `visibility:hidden` / `aria-hidden`
ancestors / disabled / clip-rect / off-viewport elements; prefers the **innermost** match
when one candidate wraps another; then prefers the **largest** remaining box, because a
screen-reader duplicate is always far smaller than the control a person sees; then
**hit-tests** the centre with `elementFromPoint` and moves to the next candidate if
something is covering it. That last step catches the other silent failure: a perfectly
visible button underneath a cookie banner.

Regression coverage lives in `dev/step-runner.test.html`, which needs a DOM and so runs in
a browser rather than in node.

## Ordering is load-bearing

Per site, in this order (`src/engine/run.js`):

1. **Server-side logout** — needs the cookies, so it must run first
2. **Park the user's tabs on that domain** — a live SPA holds tokens in memory and will
   write them straight back into `localStorage` after a wipe
3. **Destroy local data**
4. **Send the parked tabs back**, now signed out
5. **Verify** by re-reading the cookie jar

Wiping first is the classic bug: it deletes the credentials the logout request needed.

Step 2 **parks** tabs on `about:blank` rather than closing them, and that distinction is
load-bearing. An earlier version closed them, which meant "log out of all sessions" closed
every tab on every signed-in site, closed the windows containing them, and quit the
browser. Parking kills the page context just as well and nothing is destroyed.

The invariant that came out of it: **the extension must never be able to close the user's
browser.** Enforced structurally rather than by guards:

- Tabs are parked on `about:blank`, never closed, and sent back afterwards.
- **The extension does not create or remove windows at all.** Work happens in a background
  tab inside a window the user already has open; when there is none, server-side logout is
  skipped and reported as skipped. This replaced a hidden work window whose removal kept
  ending the browser session — window count is not something an extension can reason about
  reliably, and Chrome exits the moment it reaches zero.
- Exactly one `tabs.remove` call exists, inside `closeTab`, which refuses to close the last
  tab of the last window. Every caller goes through it.

Pinned by `tests/tabs.test.mjs`, which replaces `windows.create` and `windows.remove` with
fakes that throw and runs the whole tab path against them.

## Browser close

MV3 provides no dependable shutdown hook. `chrome.runtime.onSuspend` is unreliable, and a
crash, a kill, or an OS shutdown skips it entirely. Handled twice:

1. **Best effort** on `chrome.windows.onRemoved` when the last window closes. Often
   completes. Never relied on.
2. **Authoritative** on `chrome.runtime.onStartup`, using a `shutdownClean` marker in
   storage. This always fires, and runs before restored tabs can reuse their cookies.

The honest guarantee is therefore *"your sessions are gone by the time the browser is
usable again"*, not *"at the instant you closed it"*. The options page says exactly that.

Server-side logout is impossible at close time — it needs live tabs and network — so close
and startup both run the local-only path (`runLocalWipe`).

## The onboarding gate

`settings.onboarded` starts false, and `buildPlan` refuses every automatic trigger until it
is true. Enforced in the planner rather than in the event handlers, so a future trigger
cannot be added that quietly bypasses it.

The reason is behavioural, not legal. Defaults are live at install; without the gate the
first browser close signs the user out of their bank and email with no explanation, which
reads as the browser breaking rather than a feature working. The setup page lists the sites
that will actually be affected — from the real cookie jar, not described in the abstract —
and offers "manual only" for people who want the button without the automation.

## Failure reporting

Three places where an earlier version could report success it had not earned:

- **Partial wipes.** `browsingData.remove()` with several data types is all-or-nothing. The
  first version caught the rejection, deleted cookies as a fallback, and returned ok — so a
  deep wipe could silently degrade to cookies only. It now retries type by type and names
  what survived.
- **No work window.** If `windows.create()` fails, every server-side logout in the run is
  impossible. That is now stated once, rather than left to be inferred from a column of
  amber results.
- **Restored tabs.** Session restore races the startup wipe, so a tab can finish loading
  with the old cookies and *look* signed in over a session that is gone. Tabs on cleared
  domains are reloaded, because a page that lies about your auth state is worse than one
  that shows you logged out.

## The recipe update channel

Recipes change faster than releases — sites move their "sign out everywhere" buttons — so
they can be updated out of band. That makes the bundle the most dangerous surface in the
extension: the one place where somebody else's bytes influence what a security tool does.
Five rules, applied in order (`src/core/bundle.js`):

1. **Size cap before parsing.** A huge body cannot be used to wedge the worker.
2. **Signature verified before the payload is treated as anything.** ECDSA P-256, key
   pinned in the extension. The envelope carries the payload as an opaque *string* and the
   signature covers exactly those bytes, so there is no canonicalisation step in which
   signed and parsed content could drift apart.
3. **Version may not go backwards.** An old bundle carries a genuine signature forever;
   without this, an attacker who can replay one rolls users back to a recipe set whose
   problems are already known.
4. **Every recipe re-validated individually**, including the navigation trust policy. A
   signature proves authorship, not correctness — so even a compromised signing key cannot
   point the engine at an attacker's page.
5. **Failure is closed.** Any problem leaves the built-in recipes in force. There is no
   state in which a bad bundle removes or redirects coverage.

ECDSA P-256 rather than Ed25519 because Ed25519 only reached WebCrypto in recent Chrome,
and an extension that silently cannot verify its own updates on an older browser is worse
than one using a slightly older curve.

The privacy property is why this is a bundle and not an API: the **whole** list is fetched
in one request, never queried per domain. An endpoint answering "what is the recipe for
chase.com?" would leak precisely what the extension exists to protect. The request is sent
without cookies or referrer, and the feature is off until the user enables it.

Verification runs under WebCrypto, which exists in both the service worker and node, so
the whole path is tested against real keys and real forgeries in
[tests/bundle.test.mjs](tests/bundle.test.mjs).

## Claims must be earned

`revoked` tells the user their session is dead on their phone. That is a strong claim, and
the extension made it falsely: a GitHub recipe reported a revocation while every session on
the account stayed live. Three things had to be true at once for that to happen, and all
three are now closed:

- **An absence assertion needs a prior presence.** `assertAbsent` on a selector that was
  never on the page is trivially true. The runner tracks which selectors it has actually
  seen and refuses to assert that anything else went away.
- **A recipe must do something.** Every click in that recipe was `optional`, so it could
  finish having clicked nothing. `global` recipes must now carry a click that can fail the
  recipe, and the runner reports `none` when no click landed.
- **A capability claim needs evidence.** Recipes carry a `verified` date, set only after
  someone signed in on a second device, ran the logout, and watched that device get signed
  out. Unverified `global` recipes are downgraded to a local claim at run time.

No bundled recipe is verified. The extension therefore cannot currently report `revoked` at
all — which is the correct state for fifteen recipes nobody has checked.

## Federated sign-in

A site whose identity provider lives on another domain cannot be logged out alone. Clearing
`youtube.com` while `google.com` stays signed in is the case that made this obvious: the
cookies come straight back from `accounts.google.com`, and from the user's side the logout
simply did not happen.

`src/core/identity.js` expands a target list to cover its sign-in siblings, restricted to
domains the user actually has cookies for — otherwise a one-site logout would list a dozen
properties nobody uses and look far more sweeping than it is.

The membership rule is *shared authentication*, not shared ownership. Amazon owns Twitch,
but an Amazon session does not restore a Twitch one; grouping them would sign people out of
things they never asked about.

## Permission posture

`<all_urls>` is declared in the manifest, granted with one install prompt.

Zero-effort operation and per-site permission grants are mutually exclusive. An extension
that silently does nothing on sites the user never approved, while its icon sits in the
toolbar implying protection, is a worse security outcome than one honest prompt. The cost
is a scarier install screen and slower store review.

Everything else is minimised: no `webRequest` (the recorder feature that would need it is
deliberately not in the default path), no broad content script registration, no remote
code.

## Safe defaults

Automatic triggers act on **high and critical** tiers only, and deep wipes (IndexedDB,
cache storage) are reserved for critical. This is deliberate: many web apps keep drafts and
offline documents in IndexedDB, and a zero-config extension that destroys those everywhere
at browser close loses someone's work on day one and gets uninstalled — after which it
protects nothing at all.

"Protect everything" is one toggle away. It is offered, not assumed.

Ignored sites are skipped by every automatic trigger *and* by "log out of all sessions".
Only an explicit per-site action reaches them.

## Module boundaries

```
core/       pure - no chrome.* - risk, policy, planning, recipe schema
platform/   the only place chrome.* is touched
engine/     orchestration, execution, verification, reporting
background/ event wiring
ui/         popup, options
```

`core/` never imports `chrome`. That is what makes the destructive decision logic testable
in plain node — and a bug there silently wipes data the user asked us to leave alone, so it
is the layer that most needs tests. A future Firefox target or a second security module
plugs in behind `platform/` without a rewrite.

## Deliberately not built

**New-login-from-another-location alerts.** A browser extension has no channel to learn
about a login on another device. The only route is scraping each site's sessions page on a
schedule: broad permissions, constant breakage, false alarms. It would poison the privacy
story for a feature that does not work.

The realistic substitute is a **Session Inventory** — one screen deep-linking to each
supported site's own "active sessions" page, plus a nudge to enable that site's native
login alerts. Same user need, honest mechanism. Planned, not built.

## Roadmap

Current state: tiers 0, 1, 3 and 4 working end to end, 15 curated recipes, signed
update channel built and tested but not yet pointed at a live host.

1. **More recipes.** The highest-value work per hour. Each one upgrades a site from
   *cleared locally* to *revoked*.
2. **Publish the bundle host.** The update channel is built and tested; no host is live,
   which is why the feature ships switched off.
3. **Tier 2: record-once.** For sites with no recipe, let the user perform a logout while
   the extension records the *DOM path*, not the request. Optional, opt-in contribution
   upstream: domain and selectors only, never URLs with IDs, never bodies or headers.
4. **Session Inventory.**
5. **Resumable runs.** Persist the run journal so an SW teardown mid-run resumes rather
   than restarts.
6. **Firefox target** behind the existing `platform/` boundary.
