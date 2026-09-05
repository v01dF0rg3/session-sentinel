# Architecture

Design rationale for Session Sentinel, and the constraints that produced it.

## The problem

A cleanup run can produce materially different evidence:

| | What it does | Feasibility |
|---|---|---|
| **A. Local clearance** | Delete cookies and request storage cleanup for known origins in this profile | Cookie readback is observable; storage removal is API-acknowledged, not independently read back |
| **B. Site sign-out attempt** | Drive the site's own logout route or control | The action is observable; server token state is not |
| **C. Remote token invalidation** | Establish that a provider rejects a previously valid token | Not independently verified by this extension |

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
worker rather than the page, and why the extension can honestly report that sign-out was
attempted. No runtime path returns `revoked`; historical recipe metadata is not current proof.

## Execution model

The interpreter loop runs in the **service worker**, not the page
(`src/engine/logout.js` drives, `src/engine/step-runner.js` executes one step). Any step
can trigger a navigation that destroys the page's execution context; a loop running there
would simply vanish mid-recipe. So: SW issues one step → page returns a result → SW decides
the next step.

`step-runner.js` is injected via `chrome.scripting.executeScript({ func })`, which
serialises the function with `toString()`. It must therefore be entirely self-contained —
no imports, no closure over module scope.

The worker validates the landing URL before every injection. The page receives the exact
authorized origin and checks it again before using the DOM or clicking. Links, form actions,
and submit-button overrides must stay on that origin. JavaScript event handlers remain
site-controlled; these checks are not a guarantee about everything a page can do.

OIDC discovery and guessed-path probes omit credentials/referrers and refuse redirects.
Discovery has a deadline and a 128 KiB streamed-body limit. Discovered endpoints and recipe
navigations must stay on the target's HTTPS registrable site. Recognising an IdP does not
grant an unrelated site permission to direct clicks into that provider account.

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

1. **Server-side sign-out attempt** — needs the cookies, so it must run first
2. **Find the user's tabs on that domain** without navigating or closing them
3. **Destroy local data**
4. **Optionally reload matching tabs** so they reflect the local cleanup
5. **Verify** by re-reading the cookie jar

Wiping first is the classic bug: it deletes the credentials the logout request needed.

Before step 1, read-only cookie and open-tab origin hints are captured. A successful
website sign-out can erase the cookies that identified storage subdomains; the local wipe
merges and revalidates the pre-sign-out hints with its fresh scan.

Earlier versions closed or force-navigated user tabs during cleanup. Closing every targeted
tab could close the windows containing them and quit Chrome; force-navigation could disrupt
active pages. The current path only queries user tabs and, when configured, asks Chrome to
reload them after cleanup.

The invariant that came out of it: **the extension must never be able to close the user's
browser.** Enforced structurally rather than by guards:

- User tabs are never closed or force-navigated; the only optional action is reload.
- **The extension does not create or remove windows at all.** Work happens in a background
  tab inside a window the user already has open; when there is none, website sign-out is
  skipped and reported as skipped. This replaced a hidden work window whose removal kept
  ending the browser session — window count is not something an extension can reason about
  reliably, and Chrome exits the moment it reaches zero.
- Exactly one `tabs.remove` call exists, inside `closeTab`, for temporary work tabs. It
  refuses to close the last tab of the last window, and every caller goes through it.

Pinned by `tests/tabs.test.mjs`, which replaces `windows.create` and `windows.remove` with
fakes that throw and runs the whole tab path against them.

## Browser close

MV3 provides no dependable shutdown hook. `chrome.runtime.onSuspend` is unreliable, and a
crash, a kill, or an OS shutdown skips it entirely. Handled twice:

1. **Best effort** on `chrome.windows.onRemoved` when the last window closes. Often
   completes. Never relied on.
2. **Startup retry** on `chrome.runtime.onStartup`, using a `shutdownClean` marker in
   storage. After cleanup, matching restored tabs are reloaded.

Neither path guarantees work at the instant Chrome closes, and the local-only path cannot
prove that a server rejected a copied token. The options page describes the close hook as
best effort and the next-startup cleanup as a retry, not as verified revocation.

Website sign-out is unavailable at close time — it needs live tabs and network — so close
and startup both run the local-only path (`runLocalWipe`).

Failed and unfinished domains remain in the startup retry list even if their cookies were
already removed. A busy run does not mark shutdown cleanup complete. Restored-page reloads
can create new cookies after verification; startup cleanup does not guarantee a persistently
signed-out state.

## Local cleanup boundary and evidence

Domain grouping uses the full bundled ICANN + PRIVATE Public Suffix List, including wildcard
and exception rules. Hosted tenants such as separate `github.io` sites must not collapse into
one destructive target. Bare suffixes, malformed hosts, and non-registrable targets are refused.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and refresh instructions.

Cookie removal uses `chrome.cookies.remove` with URL, name, store ID, and partition key.
Reads include ordinary and partitioned cookies in the current execution-context store.
Every cookie counts in post-removal verification, including names not recognised as auth.
Permission failures and unreadable jars are not interpreted as empty jars.

`chrome.browsingData` is used only for the requested storage types, with concrete HTTP/HTTPS
origins: the site's base/www origins plus matching cookie hosts and open-tab origins, including
ports. Its broader cookie-domain expansion is intentionally avoided, because Chrome's suffix
snapshot may differ from the bundled list. See the official
[cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies) and
[browsingData API](https://developer.chrome.com/docs/extensions/reference/api/browsingData).

Only normal-profile cleanup is supported. Private windows/tabs are excluded, and destructive
popup actions from Incognito are refused. Allowing the extension in Incognito enables the
explicit private-store diagnostic, not cleanup across cookie stores.

An empty cookie readback is point-in-time evidence, not proof of remote invalidation.
Successful storage APIs acknowledge a request; contents are not independently inspected.
Unseen storage-only origins, sessionStorage, page memory, other profiles, native apps, and
future cookie regeneration remain outside the claim.

## Concurrent and interrupted work

One synchronous service-worker gate is acquired before the first await for both manual and
local-only runs. A session-storage marker records activity but does not expire underneath a
live run; a fresh worker treats an old marker as interruption evidence, not a live lock.
Alarm failures cannot strand the gate. Wakeup alarms are not a worker-lifetime guarantee.

The last report is checkpointed before work and after each site, with completed evidence
and pending domains. The popup distinguishes a live run from an interrupted checkpoint and
does not label unfinished targets as cleared. This is a progress journal, not automatic
manual-run resumption.

Privileged commands accept only the extension's named packaged UI pages. An extension ID
alone is insufficient: content scripts share that ID, so sender origin/path is checked too.

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

- **Partial wipes.** A rejected multi-type storage call cannot prove what completed. The
  engine retries type by type and reports failures separately from cookie readback. A deep
  wipe may not silently degrade to cookies only, and unavailable origin evidence makes the
  storage result incomplete.
- **No usable existing window.** A website sign-out attempt needs a real tab. If no existing
  normal window can host the temporary tab, the attempt is skipped and local cleanup is
  reported separately. The extension never creates or removes a browser window.
- **Restored tabs.** Session restore races the startup wipe, so a tab can finish loading
  with old state and *look* signed in after local data is cleared. Tabs on cleared domains
  are reloaded to refresh the view; this does not prove remote token invalidation.

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

An earlier `revoked` result told the user that sessions elsewhere were dead. The extension
made that claim falsely: a GitHub recipe reported revocation while every other session on
the account stayed live. Three holes allowed that result, and all three are now closed:

- **An absence assertion needs a prior presence.** `assertAbsent` on a selector that was
  never on the page is trivially true. The runner tracks which selectors it has actually
  seen and refuses to assert that anything else went away.
- **A recipe must do something.** Every click in that recipe was `optional`, so it could
  finish having clicked nothing. `global` recipes must now carry a click that can fail the
  recipe, and the runner reports `none` when no click landed.
- **Historical metadata is not runtime evidence.** A recipe's `capability` and `verified`
  date never authorize a remote-revocation result. An independent session on a second
  device also does not test a copied token from the original session.

Neither bundled nor downloaded recipes can report `revoked`. All four bundled recipes can
at most produce **Sign-out attempted**; legacy strong labels are rendered as unverified attempts.

## Federated sign-in

A site whose identity provider lives on another domain cannot be logged out alone. Clearing
`youtube.com` while `google.com` stays signed in is the case that made this obvious: the
cookies come straight back from `accounts.google.com`, and from the user's side the logout
simply did not happen.

`src/core/identity.js` expands a target list to cover its sign-in siblings, restricted to
the confirmed set for manual bulk runs and cookie candidates for other existing paths —
otherwise a one-site logout would list a dozen
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

Ignored sites are skipped by every automatic trigger *and* by confirmed-account bulk sign-out.
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

The recovery page now provides a local text/print handoff for use on a trusted device.
`src/core/recovery-handoff.js` builds an explicit allowlist of confirmed domains and risk
levels, independent of screen scope. It carries neither URLs nor previous progress. Shared
fixed guidance remains available with no detected accounts or an unavailable worker.
This is a reminder, not an authenticated inventory: malware on the source computer could
omit or alter it. No companion service, account sync, or server-side revocation is implied.

Current state: tiers 0, 1, 3 and 4 are implemented, four curated recipes are bundled, and
the signed update channel is tested but not pointed at a live host. Real-world sign-out
reach is measured in Diagnostics rather than assumed from automated tests.

1. **More measured recipes.** Each one may upgrade a site from *cleared locally* to a
   repeatable *sign-out attempted* path. Publish exact provider test evidence and its limits;
   do not translate historical results into a current remote-revocation claim.
2. **Publish the bundle host.** The update channel is built and tested; no host is live,
   which is why the feature ships switched off.
3. **Tier 2: record-once.** For sites with no recipe, let the user perform a logout while
   the extension records the *DOM path*, not the request. Optional, opt-in contribution
   upstream: domain and selectors only, never URLs with IDs, never bodies or headers.
4. **Session Inventory.**
5. **Resumable manual runs.** Checkpoints now exist. Safe resumption still needs a fresh
   scope/permission review and an explicit retry policy; it is not implemented.
6. **Firefox target** behind the existing `platform/` boundary.
