# Changelog

## 0.35.0 — 4 September 2026

### A recovery plan you can take to a trusted device

**Been hacked?** now offers **Print / Save PDF** and **Save text file**. The portable plan
includes confirmed domains at all risk levels, independent of the on-screen filter, and
fresh checkboxes. It excludes candidates, credentials, cookie data, usernames, full URLs,
and saved progress. Domain and risk validation limit what can enter the file.

An always-visible essential checklist covers accounts browser detection can miss. Empty
and completed lists no longer imply that recovery is finished; a failed account load offers
a retry and an essential-only printable plan. Late password-page discovery cannot overwrite
a newer scope. Recovery layout now adapts to narrow screens and has a dedicated print style.

Recovery guidance also calls out app passwords and unfamiliar recovery methods, and warns
against entering replacement credentials or viewing backup codes on an affected device.
The plan is a reminder, not a trusted inventory or proof of revocation.

- 196 Node tests (up from 187), including confirmed-only export, private-field exclusion,
  hostile input, all-risk coverage, empty plans, and large inventories.

## 0.34.1 — 2 September 2026

Both fixes come from running the diagnostics page in an installed Chrome 152. The suite
reported 14/14 passing, and two of those passes were saying something untrue.

### "217 look signed in" contradicted the rest of the product

Cookie enumeration reported `513 sites with cookies, 217 look signed in`. That count is
`likelyLoggedIn` — the deliberately generous safety-wipe scope — on a profile with **five
confirmed accounts**. Describing it as looking signed in invites exactly the reading
everything else refuses, in the one report a user is most likely to copy and paste.

It now reads `513 sites with cookies; 217 carry session-looking cookies (safety-wipe
candidates, not confirmed accounts)`.

### Current-site detection reported the extension's own id as a website

Run from the diagnostics page, the check reported *"reads the active tab as
fjhlpccnhoagchhhomaaconkhfocnjag"* — and counted it a pass. It used
`new URL(tab.url).hostname` directly, which returns the extension id for a
`chrome-extension://` URL.

`hostnameFromUrl` has always refused non-http(s) schemes, and the popup uses it, so the
popup was never wrong. Only this check reimplemented the rule and dropped it. It now uses
the shared helper and reports honestly that the active tab is not a website.

The scheme rule had no test despite being the thing that keeps `chrome://`, `file://`,
`data:` and the extension's own pages out of anything that acts on a site. It has one now.

## 0.34.0 — 2 September 2026

### Security results no longer promise what the extension cannot observe

A reached logout URL or clicked sign-out control is now reported as **Sign-out attempted**,
not **Signed out**. The extension cannot inspect a website's server-side token state, so
only a separately tested revoke-everywhere recipe may produce the strong result. Reports
saved by older versions with `loggedOut` or `revoked` values are migrated to unverified
attempts rather than repeating the old claim.

The recovery flow now starts with a clear instruction to move to a trusted device when
malware may still be active. It then prioritizes provider-owned session/device review,
followed by exposed-password changes, MFA, recovery methods, connected apps, and backup
codes. Password changes are no longer described as universal session revocation.

Browser-close wording now reflects the actual MV3 limit: cleanup at shutdown is best
effort, and unfinished local cleanup is retried at the next startup. The UI, diagnostics,
README, architecture notes, store copy, test guide, and development preview use the same
result model. A regression test rejects the strongest unsafe promises if they return.

- 186 tests (up from 182).

## 0.33.0 — 2 September 2026

### Candidates now lead to a real login instead of being manually added

**Add pre-existing accounts** is now **Log in to pre-existing accounts**, and each row's
**Add** action is now **Login**. It opens the site's own origin, confirms immediately when
the page already exposes signed-in account UI, or activates the site's visible Login
control. `/login` is used only when the homepage exposes no login route.

The login intent is tied to that tab in memory-only session storage for 30 minutes. This
survives an MV3 worker restart while the user enters credentials. Full navigations, OAuth
returns, single-page URL changes, and cookie changes all wake the existing page evidence
check; only positive evidence moves the site into Confirmed accounts. Merely clicking Login
never confirms it.

- 182 tests (up from 177).

## 0.32.1 — 2 September 2026

### The account button acts on confirmed logins only

**Log out of confirmed accounts** now stops after the confirmed set. Unresolved and
cleanup-only cookie candidates are not attempted afterwards, and identity expansion cannot
pull an unconfirmed sibling back into the run. Risk still determines order among the
confirmed targets.

Scheduled safety wipes remain deliberately generous, while explicit per-site **Log out**
and **Clear data** actions remain available for anything else.

## 0.32.0 — 2 September 2026

### Apps that build their account menu on demand are now recognised

X could not be confirmed by any of the three existing routes. No cookie appeared that was
not there at first sight, no federated round trip happened, and reading the page found
nothing: its **"Log out" does not exist in the document until the avatar is clicked**, and
while signed in it offers no "Sign in" either. Nothing to read, so it stayed a question.

But the control that *opens* that menu does exist, and X names it itself —
`SideNav_AccountSwitcher_Button`. Sites label these in their own test ids and ARIA labels,
and an account switcher is only ever rendered for someone who has an account to switch away
from.

Measured before shipping, both directions:

| Page | Account markers |
| --- | --- |
| x.com, signed in | `SideNav_AccountSwitcher_Button` |
| x.com, logged out | none |
| github.com, logged out | none |
| bloomberg.com, logged out | none |

This is inferred from a name rather than stated outright, so unlike a real sign-out control
it must also agree with the rest of the page: a page still offering to sign you in
contradicts it, and a contradiction stays a question. An explicit sign-out control needs no
such corroboration.

The pattern is generic — account switcher, account menu, user menu, profile menu, avatar
menu — rather than a rule about X. Twelve per-site recipes were deleted from this project
for being guesses about pages nobody had looked at; this one was measured on both states
before it was written.

### Also

- 177 tests (up from 174).

## 0.31.0 — 2 September 2026

### The most-used-first offer is gone

It was reported as not working three times. It was fixed twice — once by routing the
permission through Settings, once by responding to the click before awaiting storage — and
reported broken again after each. A one-line convenience that costs three rounds and still
cannot be trusted is not worth carrying.

Ordering by most-used still exists, in **Settings → Order accounts by how often you use
them**, where the checkbox has worked throughout. The popup no longer advertises it.

### Why a site you are signed into can still ask

Confirming an account happens three ways, and a site can escape all of them:

- a cookie appearing that was not there at first sight — misses accounts that predate the
  extension, and sites that carry one cookie name through login unchanged
- a federated round trip — only fires when one happens
- the page showing a sign-out control — misses apps that build their account menu only when
  it is opened

X is the third case. Its "Log out" does not exist in the page until the avatar menu is
clicked, and while signed in it offers no "Sign in" either, so there is nothing to read.

A fourth signal was tried and rejected on measurement: links to `/account` or `/settings`
paths. Logged-out bloomberg.com carries four of them — the exact site whose false
confirmation started this — so the rule would have been worse than none.

Those sites are one click on the row: **Account? Add**. Answered once, permanently.

## 0.30.1 — 2 September 2026

### The offer buttons worked at random because they answered last

Both handlers awaited something — storage, or Chrome's permission prompt — *before* touching
anything visible. So whether a click appeared to do anything depended on how long that await
took, and on whether the popup survived it. Chrome dismisses the popup to show a permission
prompt, and a popup that closes mid-await never reaches its own second line.

Both now change the UI first and persist afterwards. Neither needs the await to have
finished to be correct: the service worker mirrors a granted permission into the setting on
its own, and a dismissal that fails to persist costs one reappearing row rather than a
control that seems broken. Verified with storage artificially slowed to four seconds.

If Chrome refuses the permission request from a popup outright — some builds do — it now
falls back to opening Settings, where the same checkbox has always worked.

### Reading the page again, for apps that draw themselves late

`status === "complete"` means the document finished, not that a single-page app has drawn
its account menu. One look at that moment finds nothing on plenty of sites.

The page is now read up to three times — at load, then 2.5s and 6s later — stopping as soon
as it says something definite. Single-page route changes get a look too, since that is when
such apps tend to finish building their chrome.

The sign-out pattern is also anchored only at the start now, because sites label the control
with the account it ends: X renders **"Log out @handle"**, and demanding an exact match
missed it. Prose like "How to sign out of all devices" and "You were logged out" still does
not match.

**A limit worth stating.** Some apps, X among them, put "Log out" in a menu that does not
exist in the page until it is opened. No amount of looking at the loaded page will find it,
and opening menus on the user's behalf is not something this extension should do. Those
sites stay in the one-time **Yours?** queue, which is what that queue is for.

## 0.30.0 — 2 September 2026

### Visiting a site you are already signed into now confirms it

The last gap, and the one nothing else could reach. A sign-in is normally caught as a
cookie that was not there before, or as a federated round trip — but an account that
predates the extension has neither. Visiting it proved nothing, even though the page was,
at that moment, displaying the answer.

**The site says so.** It shows "Sign out" only to someone with a session to end, and
"Sign in" only to someone without one. That is not another guess about cookie-naming
conventions; it is the site stating the answer in words, for the user's own benefit.

So a page load on an unsettled site is read for sign-in and sign-out affordances. Found a
sign-out control — including one inside an account menu that is present but hidden, which
is how most sites build them — and the account is confirmed with nothing to answer.

**Deliberately asymmetric.** A sign-out control confirms. Nothing short of "sign-in offered
and sign-out absent anywhere" may dismiss, because a menu that renders only when opened
shows neither, and a signed-in user can be sitting on a password-change form. A wrong
dismissal hides a real account, which is the one error this must never make.

**Bounded.** It runs only for a domain that holds session-looking cookies and has not been
settled, at most once per service-worker lifetime, and never again after an answer is
recorded. A confirmed account is never inspected. A domain with no session cookies is
skipped outright — there would be nothing to confirm, and looking would be none of our
business. The injected half counts elements and returns four numbers; the judgement happens
in `core/`, where it is tested without a browser, and no page content ever leaves the page.

Measured against real pages rather than assumed: a hidden `/logout` link in a closed menu
reads as signed in; github.com signed out reads as anonymous; bloomberg.com reads as
unknown and stays a question rather than being wrongly confirmed.

### Also

- The user's own **Yours? Yes / No** still outranks everything the extension observes. When
  a person and a heuristic disagree, the person wins.
- 174 tests (up from 165).

## 0.29.0 — 2 September 2026

### A federated sign-in now confirms itself too

Detection works by spotting a cookie name that was not in the site's page-load baseline.
That misses one case, and it is narrower than "SSO": a site that carries **the same cookie
name** through login — anonymous session and authenticated session alike, changing only the
value. No name changes, so nothing is seen. Password logins on such sites are missed
identically; federation just makes it common, because the round trip leaves the site's own
cookie untouched until the callback returns.

The value does change, but anonymous session values rotate constantly, so "the value
changed" is far too noisy to mean anything.

The navigation is not. An OAuth callback is a top-level load back onto the site carrying an
authorization code, or a return trip from a provider's authorize endpoint. Neither happens
by accident, and neither requires reading a cookie value.

**The trap, and how it is avoided.** `google.com` is on the identity-provider allowlist and
is also the most-used search engine on earth, so "came from google.com" describes a search
result click far more often than a completed sign-in. A loose rule here would refill the
list with exactly the false accounts six versions have gone into removing. So the provider's
host or path must actually look like an authenticating endpoint — `accounts.google.com`,
`login.microsoftonline.com`, `/oauth/authorize` — and never a bare `www.google.com/search`.
A bare `?code=` is likewise ignored: sites use it for discount and referral codes. Only
`code` *and* `state` together is the authorization-code flow.

Writing the tests caught a real one: the first version passed a host's own domain as the
trust target, so `isTrustedLogoutDestination` matched on "same domain" and **every site
could vouch for itself**. Provider checking is now its own function.

Observed sign-ins are stored as domain and timestamp — never the URL, since an
authorization code is a credential. And the record can only ever promote a site that still
holds session cookies right now, so unlike the cache this project removed, it cannot keep a
site listed after the evidence for it is gone.

### The way into everything else was itself hidden

"Add pre-existing accounts" and "Show N other cookied sites" were rendered *inside* the
scrolling list, below whatever happened to be the last confirmed account. A profile with two
hundred cookied domains looked like a profile with four. Both now sit below the list where
they are always visible, and the list yields space to them rather than painting over the
footer.

### Also

- `topSites` grants and revocations are now mirrored into the setting by the service worker.
  Chrome can dismiss the popup to show its permission prompt, which would kill the handler
  mid-flight and leave the permission granted with the feature switched off.
- 165 tests (up from 156).

## 0.28.0 — 2 September 2026

### Signing in now confirms itself

The transition test — a cookie that was not there before — only works if "before" was
captured before the sign-in. Baselines were recorded when the popup opened, which misses
the ordinary case entirely: someone arrives at a site and signs in within the same minute,
long before anything scans, so the auth cookie is already present when the baseline is
written and the site can never be more than a question.

A domain is now baselined **when one of its pages finishes loading** — which happens when
the user reaches the login form, necessarily before they submit it. From then on the
sign-in is a new name in the jar and confirms itself with nothing to answer.

This is not a browsing record. Only domains that already hold cookies are recorded, and
only the names of their session-looking ones — every one of those facts already readable
from `chrome.cookies.getAll` at any moment. A domain with no cookies is skipped precisely
so that visiting a site never becomes something this extension stores. A test pins it.

### Most-used sites first, offered where it is visible

Ordering by the sites you actually use needs an optional permission, and its control lived
in Settings, where a preference nobody finds is a preference nobody has. The popup now
offers it in one line, once, when the list is long enough for ordering to matter.
Dismissing it is remembered.

Frequency orders and never confirms. A site visited daily is not thereby an account, and a
bank visited twice a year does not sink below a news site.

### Recovery is no longer empty when it matters most

Restricting the breach walkthrough to confirmed accounts left it with **zero steps** on a
fresh profile — telling someone who may have just been hacked to "browse a little and come
back".

The costs run opposite to the popup. A wrong row there is a false claim; a wrong row in
recovery is a password page you glance at and skip, while a *missing* row is a compromised
account that never comes up. Recovery now includes unsettled candidates, ranked below
confirmed accounts within each tier and labelled "Not confirmed as your account — listed in
case it is." Sensitivity still outranks confirmation: an unverified critical account sits
above a confirmed high-risk one.

### The Incognito experiment said the wrong thing when it failed

Incognito access is off by default, and while it is off Chrome hides private windows from
the extension entirely. So the probe reported "open one fresh blank Incognito window", the
user opened one, and got the identical message forever, with nothing pointing at the
checkbox that actually governs it. It now names `chrome://extensions` and the setting.

### Also

- 156 tests (up from 152).
- `dev/popup-preview.html` had drifted from the page it previews, again. Resynced.

## 0.27.5 — 2 September 2026

### Unknown sites stay out without making the user reject them

The Bloomberg result is now pinned as a domain-agnostic invariant rather than a one-site
exception. Any unresolved auth-looking cookie—on Bloomberg or an arbitrary future domain—
stays out of Confirmed accounts and recovery even when the site is open and highly ranked by
Chrome's top-sites list.

Pre-install candidates are now presented as **Add pre-existing accounts**. The user only
adds accounts they recognise; every ignored candidate remains safely excluded. **Not mine**
is optional queue cleanup, not work required to make the main list accurate.

## 0.27.4 — 2 September 2026

### The private result proves ambiguity, not logout

The first live private-store measurement worked in Chrome 152:

```
Domain: bloomberg.com
Normal auth-grade names: _session_id_backup
Also seen anonymously: _session_id_backup
Unexplained remainder: (none)
```

The experiment initially called that **SUCCESS** and said Bloomberg could be filtered
without asking. That conclusion was one step too strong. The result proves that the cookie
*name* `_session_id_backup` is issued to anonymous visitors and therefore cannot confirm an
account. It does not prove that the normal-profile cookie with the same name is anonymous:
a site may upgrade the same opaque session ID on the server when a user signs in.

Automatically treating equal name sets as logged out would trade false positives for false
negatives, hiding a real Bloomberg account from a signed-in user. The probe now reports
**AMBIGUOUS BY NAME**, saves no baseline or verdict, and does not change the list. Its value
is diagnostic evidence for why cookie metadata cannot answer the account question.

The production result remains the honest fallback shipped in 0.27.2: only first-sight
changes or the user's explicit Yes confirm an account; unresolved pre-install sites stay
behind **Review possible accounts**. Visit frequency can order confirmed accounts but never
promote an unresolved one. Wipe scope remains broad and unchanged.

The popup heading now says **Confirmed accounts**, not **Signed in**. A remembered “Yours?
Yes” establishes account ownership, while no browser API can guarantee the current
server-side state behind a pre-existing opaque cookie.

- 150 tests pass. The attempted cached-baseline integration and its unsafe dismissal API
  were removed before release.

## 0.27.3 — 2 September 2026

### The Incognito lead is now measurable

Chrome 152 has been measured exposing two cookie stores to the installed extension when
**Allow in Incognito** is enabled and a private window is open. That proves the separate
memory-only jar is reachable, but not yet that loading a real site there produces a useful
anonymous baseline.

Diagnostics now has a deliberately manual, one-domain private-store experiment for that
second measurement. It:

- refuses to run unless the Incognito store has no cookies and every private tab is blank;
- creates one inactive tab in the already-open private window and proves a real document
  loaded rather than trusting Chrome's `complete` status on an error page;
- reports cookie names and counts only, never values;
- closes only the tab it created and asks the user to close Incognito afterwards, which
  erases the temporary in-memory site data; and
- compares the normal and anonymous auth-grade names without changing the account list or
  saving a verdict.

The first target is Bloomberg. Equal names measure that the name is ambiguous; they do not
settle whether a normal session with that name was upgraded by authentication. Version
0.27.4 corrects the original overconfident result wording.

- 151 tests (up from 145), including opaque cookie-store IDs, refusal of used/private web
  sessions, tab cleanup, input validation, and proof that cookie values cannot escape the
  probe result.

## 0.27.2 — 2 September 2026

### Visit frequency can no longer promote a possible account

The recovery workflow bypassed the account-verdict pipeline. It fed every site that passed
the generous cookie candidate test into a page that called them accounts, then `topSites`
put frequently visited false positives first. In the popup, frequency context and account
evidence were also added into one score, so an unanswered Bloomberg or eBay row could rank
ahead of a confirmed account in the same tier.

There are now four display buckets with hard boundaries:

- **Confirmed accounts** — first-sight evidence or the user's explicit Yes.
- **Configured exceptions** — visible so a Keep choice can be reversed, but not counted as
  authentication evidence on its own.
- **Possible accounts** — collapsed behind a review control and never counted as signed in.
- **Cleanup-only sites** — still in the broad wipe scope, behind their own disclosure.

Recovery consumes only the first bucket. `topSites` can order equally risky confirmed
accounts and the review queue, but cannot move a domain between buckets. The wipe planner is
unchanged and remains deliberately generous.

Coverage history is no longer treated as proof of an account. A full cleanup acts on false
positives too, so remembering that action made a heuristic mistake permanent under a new
name.

### There is no browser-wide signed-in list to request

Chrome exposes cookie stores and cookie metadata, not the server-side identity attached to
an opaque session identifier. A fresh incognito store could reduce the review queue by
showing what some homepages give anonymous visitors, but it requires the user to enable
incognito access, contacts every tested site, misses path-specific cookies such as eBay's
`nonsession`, and cannot settle sites that reuse one opaque session cookie through login.
It is therefore not used as proof.

## 0.27.1 — 2 September 2026

### First sight was being read as proof, and it is not

The list still showed one site. Same symptom as 0.26.1, different cause, and the cause was
conceptual rather than a slip.

A first-sight baseline records what a domain already had when the extension first looked.
`judgeSignIn` treated "everything you have was there at first sight" as *anonymous*. For
anyone who was already signed in before installing — which is everyone, on upgrade — their
real auth cookie is sitting in that baseline. So every site explained itself, every site
graded anonymous, and the list emptied.

Only a list of cookies known to be handed to people with no account can prove there is no
account, and that list requires the `Set-Cookie` header Chrome will not surrender. So:

- **First sight may promote, never dismiss.** A cookie that appeared after we started
  watching is a sign-in. Everything else is a question.
- **Promotion needs both sources to agree**, where both exist. Each can be fooled alone: a
  stranger list built from one fetch misses cookies set deeper in a visit, and first sight
  contains the user's own auth cookie. When they disagree, that is a question too.
- **An empty first-sight record is evidence; a missing one is not.** `[]` says the domain
  had no auth cookies when first looked at, which makes any auth cookie now a sign-in.
  `null` says nobody has looked. Collapsing the two made every unseen site look signed in —
  the original bloomberg.com bug, reintroduced while fixing this one and caught by a test.

### What this looks like on upgrade

Almost every site starts as **Yours? Yes / No**, because almost every site predates the
baseline. Answer once and it settles. Anything signed into afterwards is detected with no
question asked.

That is a worse first screen than a confident list and a better one than a wrong list. Four
rules in a row were confidently wrong here; this one says what it does not know.

### Also

- 143 tests (up from 141). Three encoded the old semantics and were rewritten rather than
  patched — including one whose assertion was wrong, which is what surfaced the
  disagreement case above.

## 0.27.0 — 2 September 2026

### The probe in 0.26.0 could never have worked

It asked each site what cookies it hands a stranger and subtracted that from the user's
jar. The idea holds — bloomberg.com gives anonymous visitors `_session_id_backup`, httpOnly
and Secure and opaque — but the implementation was impossible, and I shipped it without
checking.

Measured, against a local server returning two `Set-Cookie` headers:

```
response.type                     'basic'      (same-origin; nothing is CORS-filtered)
response.headers.getSetCookie()   []
```

Chrome does not filter `Set-Cookie` out of the Headers object, it removes it. `basic` is
the unfiltered case, so there is no context — page or extension, same-origin or
host-permitted — where that call returns anything. Reading those headers needs
`chrome.webRequest` with `extraHeaders`: permission to observe all network traffic, which
is a large thing for a privacy tool to take in exchange for tidying a list.

The probe, its cache, and its self-test are gone.

### What replaces it needs no permission at all

An anonymous session cookie is issued on first contact and then sits there. An
authenticated one appears at the moment of signing in. So a cookie counts as evidence of an
account only if it **arrived after this extension first saw the site**. Everything already
present at first sight predates anything we could have watched, and proves nothing.

That covers every sign-in from here on, using only the cookie access the extension already
has.

### For everything else, the user is asked

The gap is a site the user was already signed into before installing: their auth cookie
went into the baseline with everything else. Nothing local can separate that, and four
rules in a row have now been wrong trying to infer it from cookies.

Rows that cannot be settled show **"Yours? Yes / No"**. One answer, respected permanently.
"No" stops the site being listed; it does not exempt it from a wipe, which is what the Keep
control is for. This is the escape hatch that lets the automatic rules be imperfect — they
only have to be right often enough to keep the question short.

### Also

- 141 tests (up from 140).
- Diagnostics no longer offers to test whether sites can be asked. It states what the rule
  actually is and what it cannot see.

## 0.26.1 — 1 September 2026

### The list came back holding one entry

0.26.0 shipped with a bug that made it strictly worse than the problem it fixed: the popup
showed a single site, and that one only because it was on the never-clear list. Nothing was
judged signed in at all.

On the first scan of a domain, its current session-looking cookies are recorded as a
baseline — they predate anything the extension could have watched, so they prove nothing.
The record was then used to judge the very same cookies, in the same pass, microseconds
after being written from them. Every cookie was ruled out, every remainder was empty, and
every site graded anonymous.

Worse than a wrong answer: nothing was left marked `unknown` either, so the probe that asks
sites what they give strangers — the entire point of the release — never ran once.

A baseline is evidence from the scan *after* the one that captured it. `recordFirstSight`
now reports which domains were new, and those are judged as `unknown` rather than against
themselves. Two tests pin it, including the exact shape of the mistake.

### Unchecked sites are shown, and worded as the doubt they are

Hiding every site nothing had checked yet is what left the list with one entry. They are
shown again, ranked below confirmed accounts and labelled **"cookies look like a sign-in,
not confirmed yet"** — never as "you are signed in here", which is the claim that started
all of this. A row worded that way disappears once the site has been asked.

### Also

- 140 tests (up from 138).

## 0.26.0 — 1 September 2026

### A session cookie is not evidence of an account

Three rules in a row tried to read authentication out of a cookie's name and flags:
generous name matching, then `httpOnly` as a discriminator, then a list of names that say
they are not sessions. Each fixed the site that was reported and stayed wrong.

They were wrong in principle. Fetched with no cookies at all, as a stranger with no
account, bloomberg.com hands back:

```
_session_id_backup    httpOnly  Secure  36-char opaque value
```

That is indistinguishable from an authenticated session cookie because it **is** a session
cookie — an anonymous one, issued before anyone signs in. No rule over names and flags can
separate the two, because the difference is not in the cookie.

### Ask the site what it gives a stranger, and subtract

Measured, with no cookies attached:

| Site | What a stranger receives |
| --- | --- |
| bloomberg.com | `_pxhd`, `session_id`, `_session_id_backup`, `agent_id`, `session_key` |
| github.com | `_gh_sess`, `_octo`, `logged_in` |
| x.com | `guest_id`, `guest_id_ads`, `gt`, `personalization_id`, `ct0`, `__cf_bm` |

A jar holding exactly what a stranger gets proves nothing. A signed-in GitHub user also has
`user_session` and `dotcom_user` — cookies that only exist in response to something a
stranger cannot do. That remainder is the account.

Two independent sources rule cookies out, and they combine rather than override:

- **Asking the site**, credentials omitted, cached per domain. Settles sites the user was
  already signed into when the extension was installed.
- **First sight**: whatever a domain already had the first time it was scanned. It predates
  anything we could have watched, so it proves nothing — and it catches what one homepage
  fetch misses, such as eBay's `nonsession`, which arrives deeper than the front page.

**With neither available the answer is `unknown`, and unknown is not shown.** Getting that
order wrong is the original bug in a new costume: with nothing to subtract, every cookie
survives the subtraction and every site looks signed in. A test pins it.

### It reports which method is actually working

`Set-Cookie` is a forbidden response header, and whether Chrome exposes it to an extension
through `getSetCookie()` is a fact about a real browser rather than something to reason
about — reasoning about it is what produced the last three fixes.

**Settings → Check it works → Why these sites are listed** now measures it against
github.com, whose anonymous cookies are known, and says either which names came back or
that this browser will not allow it and first-sight baselines are carrying the work alone.

### Also

- 138 tests (up from 130). The `anon-baseline` fixtures are real measurements, not invented
  cookie names.

## 0.25.0 — 1 September 2026

### The fix in 0.24.0 could not reach anyone

ebay.com kept saying "shown because you are signed in here" after the rule that put it
there was corrected — and so did every other site misjudged in that window.

0.23.0 added a permanent record of every domain ever judged signed in, so a site would
survive the logout that removes the cookies proving it. The popup unioned that record with
live cookie evidence. Nothing ever re-checked an entry, so a heuristic mistake became
immortal: eBay was written in while `nonsession` still counted as an auth cookie, and
stayed listed forever after.

A cached judgement is only as good as the judgement, and this one had no way to change its
mind. **The record is gone.** The signed-in set is now derived from the cookie jar on every
read, so correcting a rule actually reaches the user.

Surviving our own wipe was the record's only real justification, and it was already covered:
`acted` lists sites this extension has signed the user out of. That records what the
extension *did*, not what it *concluded*, so it cannot be wrong in the same way.

Settings v6 deletes the stored key on upgrade. Deleting the code is not enough — the stale
answers lived in storage, and would have kept being read.

A test now pins the invariant directly: a domain judged signed in must stop being judged so
the moment the cookie behind it changes.

### Also

- 130 tests (up from 128), including the eBay cookie set end to end.

## 0.24.0 — 1 September 2026

### ebay.com was on a list headed SIGNED IN, on the sign-in page, with no account

Two causes, found because the screenshot happened to show the sign-in form unfilled.

**`nonsession`.** The stems that recognise auth cookies match anywhere in a name, which is
what lets `PHPSESSID` and `__Secure-1PSID` be recognised without a table of every
framework's spelling. It also means eBay's `nonsession` cookie — the one that holds state
for people who are *not* signed in — matched `sess`. It is httpOnly, Secure and long, so it
graded as a real auth token.

Names that say in words that they are not an authenticated session are now excluded:
`nonsession`, `anon_session`, `unauth`, `preauth`, `no_session`, `sessionless`,
`logged_out`, `signed_out`, `oauth_state`, `csrftoken`, `xsrf-token`, `assessment`. The
negative prefixes are anchored to a separator and must sit immediately before the stem, so
`unified_auth`, `nonce_auth` and `__Secure-authjs.session-token` are untouched. Both halves
are pinned by tests.

**Being open in a tab.** 0.23.0 counted "open in a tab right now" as a reason to list a
site, on the grounds that it is strong evidence of use. It is — and use is not the question.
Sitting on a sign-in page is the counterexample: maximum evidence of attention, zero
evidence of an account. `open` and Chrome's top-sites list now order the list without ever
joining it.

What qualifies a site is now only: a convincing auth cookie, or this extension having
signed the user out of it before.

### A way to argue with the list

Two rounds of this were diagnosed by reasoning about cookie names from memory. That does
not scale to a profile with hundreds of domains on a machine nobody debugging it can see.

**Settings → Check it works → Why these sites are listed** now names the exact cookies that
put each site on the list, with a Copy button. If something there is not an account, the
cookie that caused it is on screen and the rule can be fixed against evidence instead of
recollection.

Names only. A cookie's value is the session token itself and is never rendered or copied.

### Also

- `dev/diagnostics-preview.html` had drifted from the real page it previews; resynced.
- 128 tests (up from 125).

## 0.23.0 — 1 September 2026

### "225 signed-in sites" was not true

A real profile reported 225 signed-in sites and led with `aol.com` — an account the user
does not have. Two separate mistakes, both in the same direction.

The heuristic that finds sessions is deliberately generous, because the cost of missing one
is leaving a live token behind. It was also being used to decide what to put on screen,
where a wrong yes is exactly what produces a wall of sites. Worse, any cookie with no
expiry counted — which is most analytics and consent cookies.

Sign-in evidence is now graded separately from wipe scope. **The discriminator is
`httpOnly`**: analytics, consent and preference cookies have to be readable by page scripts
or they are useless, while real auth cookies are set `httpOnly` precisely so a cross-site
script cannot steal them. Nothing else separates the two nearly as cleanly — not expiry,
not the name.

- **strong** — a session-ish name, `httpOnly`, `Secure`, and a value long enough to be a
  token. `sessionid`, `PHPSESSID`, `__Secure-1PSID`, `user_session`.
- **moderate** — unmistakable name and `httpOnly`, but missing `Secure` or short.
- **weak** — script-readable. `csrftoken` has "token" in the name and is *required* to be
  readable; it is not proof of a session.

A site is shown as signed in with one strong cookie, or two moderate ones. In the harness
that takes a 48-site fixture to 6.

**Wipe scope is unchanged.** `likelyLoggedIn` is still generous and still decides what gets
cleared; only the display question got stricter. Narrowing both would start leaving live
tokens behind — the exact failure this extension exists to prevent. A test pins the pair.

### Being a high-value account is no longer enough to be listed

0.22.0 promoted anything in the curated critical list on the reasoning that a bank behind a
disclosure was worse than a longer list. That was compensating for a sign-in signal too
weak to trust, and it is what put `aol.com` in front of someone with no AOL account. With a
signal that answers the question directly, the compensation *is* the bug: a bank you are
signed into shows because you are signed into it, and one you are not does not need the
space.

### The list remembers accounts across the logout that clears them

Sign-ins observed during a cookie scan are recorded — registrable domain and timestamp,
nothing else — so a site stays on the list after the extension has removed the very cookies
that proved it. A list that forgot a site the moment it did its job would be useless.

**Not `chrome.history`**, which was the obvious idea and is the wrong instrument twice: it
answers "what pages did you open", which cannot tell a news article from an inbox, and it
is an enormous thing for a privacy tool to ask for — every URL, with timestamps, forever,
to answer a question about domains.

**Not `chrome.cookies.onChanged`** either. In MV3 a listener wakes the service worker, and
that event fires for every cookie written anywhere in the browser — hundreds a minute,
almost none of them sign-ins. The cookie jar is already scanned in full whenever the popup
opens or a run starts, so the same conclusions are free at those moments.

The record is capped at 800 domains, evicted oldest-first, never leaves the machine, and is
cleared by the same control that clears the coverage tally.

### Also

- The popup header read `225 sites` under a heading saying SIGNED IN. It now reads
  `6 of 48`, with the total explained on hover and still covered by a full run.
- The scope line says "found in this browser" rather than "found here", which could be read
  as "found in this list".
- 125 tests (up from 115): `tests/sign-in.test.mjs`, including a fake cookie jar that pins
  the analytics-only case.

## 0.22.0 — 1 September 2026

### The list is a list again, not a wall

Cookie discovery finds every registrable domain with an auth-looking cookie. On a real
profile that is hundreds, and the popup showed all of them — so the accounts that mattered
sat somewhere below forty forums the user last opened in 2023.

The list is now split rather than trimmed. Sites are shown first when there is evidence
the user actually uses them:

- open in a tab right now
- among Chrome's top sites (optional permission, still off by default)
- previously signed out of with this extension
- a known high-value account, whether or not it shows signs of use — a bank buried behind
  a disclosure is a worse failure than a list three rows longer

Everything else collapses behind **"Show N other sites with sign-in cookies"**, which
states the count rather than saying "more": that a profile carries two hundred other
cookied domains is itself information. Shown sites are grouped under sticky tier headings,
so a scrolled list stays legible instead of reverting to an undifferentiated column.

**This changes what is displayed, not what is done.** The site count above the list still
reads the whole set, "Log out of all sessions" still acts on the whole set, and typing in
the filter searches the whole set — a filter that could not reach a site because it sat
behind a disclosure would be maddening. A display filter that quietly narrowed the run
would be the same class of lie as reporting `revoked` for an orphaned session.

### Finding the password page without a hand-written table

The extension cannot make a site revoke its sessions, and neither can anything else
installed in a browser. Every mechanism that could — Shared Signals, RISC, CAEP,
device-bound credentials — is server-to-server or lives in the browser itself. What is
true is that on most stacks **changing the password is the revocation**: it is what
invalidates sessions on devices the user no longer holds.

Until now that link came from a curated table of two dozen domains, and everything outside
it got "check its account security settings" — advice-shaped, but not actually advice.

The "Been hacked?" walkthrough now also asks sites directly, via
`/.well-known/change-password`. Measured against 30 popular domains: 11 serve it, 14
return a clean 404, and 5 answer `200` for URLs that cannot possibly exist.

- The curated table still wins where it has an entry. A hand-checked URL beats a redirect
  we have only proved is not a 404.
- Sites with no real 404s are refused, not guessed at. The spec's own control probe asks
  for a deliberately impossible URL first; if *that* returns 200, the site's status codes
  carry no information. Skipping this check is how the Proton 404-tab bug happened, and
  opening a blank error page during a break-in is worse than admitting we do not know.
- The apex is not the last word. `google.com` 404s while `accounts.google.com` serves it,
  so `accounts.` and `www.` are tried before giving up.
- A network failure is never cached as absence. Offline is a fact about the moment.
- The user is handed the well-known URL itself, not a resolved one — their browser follows
  the redirect with their own cookies and lands signed in, where ours would have followed
  the logged-out branch to a login screen.
- Where a link was discovered rather than curated, the row says so.

### Also

- README now leads with what the extension *cannot* do, the three-rung ladder, and the
  measured numbers behind it, rather than leaving that to the results table.
- 115 tests (up from 105): `tests/relevance.test.mjs`, `tests/change-password.test.mjs`.

## 0.21.1 — 1 September 2026

### Fixed

- **The popup footer was cut off**, taking "Been hacked?" and "Settings" with it — the two
  links that lead anywhere else in the extension, invisible.

  Chrome caps a popup at 600px and sizes it to the document. The content had grown past
  that (current site, main button, scope line, crash banner, a fixed 240px site list,
  footer), so the page itself scrolled and the footer sat below the fold.

  The popup is now a bounded flex column: the site list absorbs whatever space is left and
  scrolls inside itself, the footer is pinned where it can always be reached, and neither
  the page nor the root element can scroll. The list gets more room when there is no crash
  banner to display, rather than being fixed at a height chosen for the worst case.

## 0.21.0 — 31 August 2026

### Coverage measurement

Four sites have a hand-written recipe. The other two hundred rely on a generic fallback
that probes for a logout URL and, failing that, hunts the homepage for a sign-out link.
Whether that works on most sites or almost none had never been measured — and without a
number, choosing which site to write a recipe for is intuition, which is precisely how
twelve recipes came to be written for pages nobody had looked at.

The extension now counts its own results. Diagnostics reports the hit rate, which tier did
the work, and names the sites where nothing worked:

> 5 of 7 sites had their session actually ended (71%).
> 2 × built-in recipe · 2 × logout URL found by probing · 1 × sign-out link on the homepage
> **2 sites where nothing worked — these are the ones worth a recipe:** chase.com,
> breadpayments.com

Ordinary use becomes the evidence, and the next recipes get chosen by data rather than by
guessing.

Two things the number is careful about, both pinned by tests:

- **Only attempted sites count.** A site below the tier threshold was never tried, so
  counting it as a miss would blame the fallback for a decision the planner made.
- **Failures are counted apart from misses.** "The wipe itself failed" is a different
  problem from "no sign-out was found", and folding them together hides one behind
  the other.

Which tier did the work is now recorded structurally rather than parsed back out of a
description string.

The tally stores a domain, an outcome, and a method. No URLs, no visit times, nothing about
what was done on the site — it is a record of the extension's own behaviour.

### Tests

94.

## 0.20.0 — 31 August 2026

All four items below came from testing on a real profile.

### Fixed

- **No tab is opened on a logout URL that does not exist.** Logging out of Proton opened a
  visible 404: `proton.me/logout` is not a page, and the fallback navigated there anyway.
  The engine now probes candidate paths with a HEAD request first and only opens a tab on
  one that answers. Only an explicit 404 or 410 rules a path out — plenty of sites answer
  405 to HEAD, which means nothing either way.

  The probe list includes the `account.` subdomain, because Proton's logout lives at
  `account.proton.me/logout` while the bare domain has none. Cheap to check, impossible to
  guess. It also spares a wasted tab on vast.ai, whose `/logout` 404s too — the homepage
  fallback was quietly doing the work there all along.

- Proton added to the known-sites list. Its account app answers 200 for any path, so the
  link is the account root rather than a deeper URL that would only look more precise.

### Changed

- **The compromise warning is back to high-risk sites only.** It briefly fired on every
  logout, when an interruption was the only route to that advice. "Been hacked?" is now a
  permanent, discoverable route to the same thing, so the prompt no longer has to carry the
  whole message — and a warning people see constantly is one they learn to dismiss.

### Added

- **Optional: order accounts by how often you use them.** Uses `chrome.topSites` — the
  new-tab shortcuts, not browsing history — behind an optional permission that is off by
  default. A privacy tool does not get to quietly widen its own access.

  It never changes a risk tier. A news site read daily is not more dangerous to lose than a
  bank visited twice a year, and letting visit counts drive sensitivity would get the
  ordering backwards. It breaks ties *within* a tier: given two equally critical accounts,
  start with the one the user actually lives in. Pinned by a test.

### Tests

87.

## 0.19.0 — 31 August 2026

### Compromise recovery

The per-site warning answers "what do I do about this account". This answers the question
someone actually has on a bad day: *my email was breached — what else is exposed, and in
what order do I fix it?*

**Been hacked?** in the popup opens an ordered walkthrough of every account worth securing,
grouped by blast radius rather than by risk score. That distinction is the whole feature.
Risk tier says how bad losing an account is; recovery order says which account, secured
second, was used to retake the first. Email and identity providers come first regardless of
tier — securing a bank before the mailbox that receives its password-reset link is wasted
work, because the attacker just resets it again. Then money, then infrastructure, then
social.

- Links straight to the password page where one is known, the site itself where not. No
  settings path is ever guessed.
- Notes where one password change covers several accounts, so nobody hunts for a password
  page that does not exist — a Google change covers YouTube.
- Keeps your place in `chrome.storage.local`. Fourteen accounts takes long enough that the
  browser will be closed or crash partway, and a recovery abandoned halfway leaves the tail
  end permanently unsecured.
- Scope is adjustable from critical-only to everything you are signed into. Defaults to
  critical and high: a breach response listing two hundred forums is one nobody finishes.
- The never-clear list is deliberately ignored here. It governs what may be *destroyed*;
  this destroys nothing. A compromised account you asked not to log out of is still
  compromised.

Nothing on the page logs anyone out, and it says so at the top.

### Changed

- The welcome page now explains that clearing a site does not always end its session — that
  it can abandon one instead. It is central to how the extension behaves and it was missing
  from the first thing a new user reads.

### Tests

85.

## 0.18.0 — 31 August 2026

### The warning now covers every site

0.17.0 only warned on the 19 sites with a known password-change URL. Every other site — the
other ~200 in a real profile — was logged out silently, which is precisely backwards: the
sites nothing is known about are the ones where the user is least likely to know what their
options are.

The warning now appears for **every** site, and degrades honestly rather than disappearing:

| What is known | What the user gets |
|---|---|
| Password page | A direct link |
| Session list only | That link, plus generic password advice |
| Nothing | The site itself, and where to look once there |

No settings path is ever guessed. Sending someone confidently to a URL that does not exist
is how twelve recipes died; the site root is an honest starting point and the user knows
their own sites.

It also defaults to **every site** rather than high-risk only. Click-through fatigue is a
real cost, and the smaller one: the alternative is silently logging someone out of a
compromised account while the attacker's session continues, having never mentioned the one
action that would have stopped it. Settings offer high-risk-only or never.

The advice disappears entirely for any site with a verified global logout. Nothing
qualifies today; the check exists so it stops the moment something does.

### Tests

75.

## 0.17.0 — 31 August 2026

### Offer the password route before logging out

Most sites cannot end sessions on your other devices, so a logout only affects this
browser. Where that is true, the extension now says so *before* it acts, and offers the
thing that does work.

The ordering is the entire point. If someone else is holding a live session, logging
yourself out is the wrong first move: it surrenders the one authenticated session you
control and leaves theirs running. Changing the password from the session you already have
ends every other session at once and keeps you signed in. Offering that afterwards would be
useless, because by then the useful option has been thrown away.

Clicking **I think I have been hacked** opens the site's password settings and deliberately
does *not* log you out. **No, just log me out** proceeds as before.

Defaults to high-risk sites rather than all of them: a prompt that fires on every logout is
one people learn to click through, which wastes it exactly when it matters. Configurable to
every site or never.

Password-change URLs for 19 sites, each checked to resolve. Proper display names too —
"Github" and "Linkedin" read as carelessness in a tool asking to be trusted.

### Fixed

- **"Log out of all sessions" would have taken half an hour.** 0.15.0 made explicit
  logouts attempt a server-side sign-out regardless of tier, which was right for one site
  and wrong for all of them at once: a profile with 218 signed-in sites would have spent
  roughly ten seconds each opening tabs, uninterruptibly. Picking a single site still
  ignores the threshold; bulk runs respect it again.

### Tests

74.

## 0.16.0 — 31 August 2026

### Google verified, and the whole chain with it

Logging out of youtube.com made the browser's session **disappear from
myaccount.google.com/device-activity**. That single observation confirms three separate
mechanisms working together, each of which was a guess until now:

1. **Federated expansion** — youtube.com pulled in google.com, because clearing YouTube
   alone would have been undone by the live Google session on the next visit.
2. **Tier-independent explicit logout** — youtube.com is `low` tier and, before 0.15.0,
   would not have attempted a sign-out at all.
3. **The sign-out itself** — the session was *ended*, not abandoned. It left the device
   list rather than accumulating on it.

`google.com` now carries a `verified` date. Two of four recipes are confirmed by
observation; amazon.com and reddit.com remain unchecked.

### Tests

69.

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
