# Session Sentinel

[![tests](https://github.com/v01dF0rg3/session-sentinel/actions/workflows/test.yml/badge.svg)](https://github.com/v01dF0rg3/session-sentinel/actions/workflows/test.yml)

Session Sentinel is a Chrome extension that attempts website sign-out and clears local
session data quickly. You can run it yourself, or have it act after inactivity, when your
screen locks, or around Chrome closing.

It is designed for the moment when speed matters: you think your computer or an account may
be compromised and you want to begin securing your sessions now.

> **Important:** Session Sentinel is a security and recovery aid, not antivirus. No browser
> extension can guarantee that a token already stolen by malware has been revoked. If you
> suspect malware, use a known-clean device for account recovery whenever possible.

## Why I made Session Sentinel

I made Session Sentinel after malware compromised my Windows computer and stole my browser
session tokens, including my Discord token. A session token is the proof a website uses to
remember that you are signed in; someone who steals a valid token may be able to enter the
account without typing your password. The attacker gained access to my Discord account,
Riot Games account, and many others.

During an attack like that, every minute matters. I needed a fast way to contact many sites
and clear local sessions without searching through every website one at a time. I also
needed honest results: reaching a logout button is useful, but it does not prove that a
copied token has stopped working.

If I had had a tool like this, I could have started containment and account recovery sooner.
I am building Session Sentinel so other people have more options, clearer information, and
a guided place to start when they know they are being hacked.

## What it does

- Shows **confirmed accounts** first instead of treating every website cookie as a login.
- Opens uncertain sites so you can log in—or confirm that you are already logged in—with
  very little manual work.
- Tries to use each website's real sign-out process, then clears its local session data.
- Can act automatically after inactivity, screen lock, sleep, or browser close.
- Shows what was attempted, what Chrome confirmed locally, and what needs attention.
- Provides a **Been hacked?** checklist that starts with the accounts that can unlock all
  your other accounts.
- Prints or saves a private recovery plan you can use on another trusted device.
- Lets you mark sites **Never clear this site** when you want them left alone.

Session Sentinel does not upload a list of your accounts or browsing activity.

No Chrome permission gives an extension an authoritative list of every website where the
user is currently signed in. Session Sentinel therefore requires positive login evidence
before putting a site in **Confirmed accounts**, and keeps uncertain cookie-only sites in a
separate candidate list.

## What each result means

Websites do not provide one universal “sign out everywhere” button for extensions. Session
Sentinel goes as far as each site allows and reports the result honestly.

| Result | What it means |
| --- | --- |
| **Sign-out attempted** | A website logout route or control was reached and local cleanup passed its checks. This does not prove a copied token stopped working. |
| **Cleared locally** | No cookies remained at the check, and Chrome accepted the requested storage cleanup for known site addresses. Stored content was not independently read back. |
| **Needs attention** | Cookies remained, a cleanup request failed, or verification was unavailable. The details explain what was observed. |

Expand **Last cleanup** in the popup for each site's evidence. An interrupted run shows
unfinished sites rather than presenting partial work as a completed run.

These checks cover the **normal Chrome profile only**, not Incognito or other profiles.
They cannot verify copied tokens, other devices, data held in open tabs, or storage on
addresses the extension did not discover. A page can also create new cookies after a check.
“Allow in Incognito” does not add private-account cleanup.

Clearing local data reduces exposure in this profile. A sign-out attempt may also invalidate
a session, but **this version never reports verified remote revocation**, even for a recipe
tested in the past. If a token may have been stolen, review the website's active sessions or devices,
remove unfamiliar entries, use **sign out everywhere** when available, and change an exposed
password. Password-change behavior varies, so verify the session list afterward.

## If you believe you are being hacked now

1. **Move to a known-clean device if possible**, such as another computer or phone you
   trust. An extension running on an infected computer cannot make that computer safe.
2. **Secure your main email and sign-in accounts first**, such as Google, Microsoft, or
   Apple. Attackers can use them to reset the passwords for many other accounts.
3. Open Session Sentinel and select **Been hacked?** to work through the guided account
   list.
4. Use each site's security page to revoke unknown sessions or sign out other devices.
5. Change exposed passwords and do not reuse the same password across sites.
6. Turn on two-step verification (multi-factor authentication) or passkeys, and replace
   recovery codes that may have been exposed.
7. Remove the malware—or reinstall Windows—before trusting the affected computer again.

**Attempt sign-out of confirmed accounts** is an optional containment action. If malware may
still be running, do the recovery steps from a trusted device first; the button does not make
an infected computer safe and does not prove that stolen tokens were revoked.

### Take the checklist to a trusted device

Open **Been hacked?**, then choose **Print / Save PDF** or **Save text file**. In Chrome's
print dialog, choose a printer or **Save as PDF**. You can also read a printout or photograph
it with your phone, without installing Session Sentinel on the other device.

The plan includes your confirmed website domains at **every risk level**, even when the
screen shows only high-risk accounts. It leaves out uncertain candidates and starts with
fresh, unchecked boxes. It contains no passwords, cookies, tokens, account usernames, or
security-page links. Keep it private: the website names can still be personal information.

Always follow the **essential accounts** checklist too: email, sign-in providers, password
managers, banking, work, and social or gaming accounts. Browser detection can miss accounts,
including ones used in other profiles or apps. An empty list does **not** mean you are safe.
If account loading fails, you can still print the essential checklist.

A plan made on an infected computer could be incomplete or altered. Open services through
their official apps or bookmarks you trust, not because an unfamiliar domain appears in
the plan. Review each login you use on a service; several accounts can share one domain.
Checking a box records your review, not proof that a stolen session was revoked.

## Install from this repository

Session Sentinel currently loads directly from its source folder. You do not need to
compile anything. Chrome 119 or newer is required.

1. [Download Session Sentinel as a ZIP](https://github.com/v01dF0rg3/session-sentinel/archive/refs/heads/main.zip),
   then choose **Extract all** when the download finishes.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder containing `manifest.json`.
6. Complete the setup page that opens, then pin Session Sentinel to the toolbar if desired.

Automatic protection stays off until setup is completed, giving you a chance to review the
affected sites first. Manual actions are available immediately.

An unpacked extension does not update itself from GitHub. To install a newer version,
replace the old project folder with the new download and select **Reload** beside Session
Sentinel on `chrome://extensions`.

## Using the account list

### Confirmed accounts

These are sites where Session Sentinel found positive evidence of a login. The extension
may have watched the sign-in happen, found signed-in account controls on the page, or seen a
new authentication cookie appear.

The **Attempt sign-out of confirmed accounts** button acts only on this list. Riskier
accounts are handled first.

By default, selecting **Attempt sign-out** beside a high-risk site opens a confirmation
window. Choose **Attempt sign-out anyway** to continue, or **Cancel** to return without
starting that action. If you think you've been hacked, choose **Open recovery checklist**
instead and use another trusted device if malware may be active. The full warning is under
**Why recovery may need more steps**.

### Pre-existing account candidates

Some sites already had session-looking cookies before Session Sentinel was installed. A
cookie alone cannot prove that you have an account; news sites and shopping sites also give
cookies to anonymous visitors.

Open **Log in to pre-existing accounts** and select **Login** beside a site:

1. Session Sentinel opens the real website.
2. If the page already shows that you are signed in, the site is confirmed automatically.
3. Otherwise, the extension activates the site's own Login control or opens its usual
   `/login` page.
4. After you finish signing in, reopen the popup. The site moves to **Confirmed accounts**
   when positive login evidence is available.

Selecting Login never confirms an account by itself. If the site still cannot prove the
login, it remains a candidate. Select **Not mine** only when you want to remove a site from
the candidate list.

### Other cookied sites

This section contains websites with local data but no reliable evidence of an account. They
are not included by the manual **Attempt sign-out of confirmed accounts** button.

### Ordering by usage

The optional **Order accounts by how often you use them** setting only changes the order of
confirmed accounts. Visiting a site frequently never turns it into a confirmed account.

## Automatic protection

The default settings are:

| Trigger | Default behavior |
| --- | --- |
| Browser closes | High- and critical-risk sites |
| 30 minutes of inactivity | Critical-risk sites |
| Screen lock or sleep | High- and critical-risk sites |
| Contact sites to sign out | High- and critical-risk sites |

Automatic safety wipes use a broader session-candidate list than the manual confirmed-
account button. This favors removing suspicious local session data during an automatic
security event, but it can sign you out of a site that was not shown as a confirmed account.

Use **Never clear this site** for music players, work dashboards, home-control pages, or
anything else that should survive automatic cleanup. You can still use that site's
individual **Attempt sign-out** or **Clear data** button later.

Deep cleanup, including IndexedDB and cache storage, is limited to critical sites by
default. Clearing those storage types everywhere could destroy offline drafts or locally
saved work.

## Shared sign-ins

Some sites share one identity. YouTube uses a Google session, Instagram may depend on
Facebook, and Outlook uses Microsoft. Clearing only the first site may let the identity
provider sign it straight back in.

Session Sentinel groups known shared identities when the related accounts are confirmed
and explains which sites were included. A site marked **Never clear** is still respected.

## Check that it works on your computer

Open **Settings → Check it works → Run diagnostics**. The diagnostics exercise the browser
features Session Sentinel relies on and report what actually works in your installed copy.

The check does not delete real website data. It creates two public dummy cookies on a
reserved `.invalid` domain, removes them through the real cleanup code, and checks that
both disappeared. This includes Chrome's partitioned cookies, which are kept separately
for the websites that embed them. Leftover test cookies expire within two minutes. Real
cookie values are not displayed or copied. Passing diagnostics does not prove remote
session revocation.

The same page includes:

- **Coverage**, which measures how often Session Sentinel reaches a website logout route or
  control. It does not treat that reach as proof that a copied token was invalidated.
- **Activity log**, which shows whether a run completed or Chrome stopped it partway
  through.
- **Why these sites are listed**, which identifies the cookie name that made a domain a
  candidate.
- An optional **Private-store account check** for comparing one site's cookie names with a
  fresh Incognito visit. Close every Incognito window afterward to erase its temporary
  data.

If something unexpected happens, use **Copy report** and include it in a
[GitHub issue](https://github.com/v01dF0rg3/session-sentinel/issues).

## Privacy and permissions

- No Session Sentinel account is required.
- No telemetry or analytics is collected.
- Account decisions and settings stay in Chrome's local extension storage. Short-lived
  Login-tab tracking stays in session storage and expires after 30 minutes.
- The extension does not request browsing-history access.
- Optional top-sites access is used only when you enable usage-based ordering.
- Optional recipe updates request one complete signed bundle; they do not query a server
  once per account or upload your site list.

Chrome shows an **access to all sites** warning because Session Sentinel must be able to
inspect account controls, attempt a site's sign-out, and clear session data on whatever sites
you use. Asking for permission one site at a time could make requested cleanup incomplete
without making the missing site obvious.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy and [STORE.md](STORE.md) for the
permission justifications.

## Technical details

The remainder is for contributors and security reviewers. You do not need it to use the
extension.

### How website sign-out works

Replaying a previously captured logout request is unreliable because CSRF tokens rotate
and cross-site requests do not receive the right `SameSite` cookies.

Session Sentinel instead borrows an existing Chrome window, opens a background tab on the
site's own origin, and tries these steps in order:

1. A curated, declarative logout recipe.
2. An advertised OpenID Connect logout endpoint on the same site.
3. A generic search for the site's own visible logout control.
4. A local cookie and storage cleanup attempt, regardless of the sign-out result.

No window is created or closed. Open tabs on a cleared site can be reloaded so the local
cleanup is visible. A successful click or navigation is reported as an attempt, not as proof
that the server invalidated the session token.

Recipes are data, not remote code. Their interpreter ships inside the extension, navigation
is restricted to the intended site, and downloaded bundles
must pass signature, version, schema, and navigation checks.

### Tests

Run the Node test suite:

```bash
npm test
```

Run the browser test harness:

```bash
node dev/server.mjs 5599
```

Then open `http://localhost:5599/dev/step-runner.test.html`. The same server hosts UI
previews at `dev/popup-preview.html` and `dev/options-preview.html`.

### Project layout

```text
src/core/       Pure decision logic; no chrome.* APIs
src/platform/   Chrome API access and persisted browser state
src/engine/     Logout execution, verification, and reporting
src/background/ Browser events and message handling
src/ui/         Popup, settings, diagnostics, and recovery pages
data/           Bundled risk classification
dev/            Local test harness and development utilities
```

The central boundary is that `src/core/` never imports `chrome`. Browser integrations sit
behind `src/platform/`, keeping decision logic testable and leaving room for a future
Firefox adapter.

### Icons

```bash
npm run icons
```

This regenerates all icon sizes from [dev/make-icons.mjs](dev/make-icons.mjs).

### Signing keys

The recipe-bundle signing key lives outside this repository at
`~/.session-sentinel/keys` by default. Set `SENTINEL_KEY_DIR` to override that location.

### Security boundaries

Three attacker-influenced inputs are constrained:

- OIDC logout destinations must remain on the target site. A site's instructions cannot
  authorize clicks in an unrelated identity-provider account. Redirects and the page's
  origin are checked before automation.
- Recipes cannot navigate away from the site they claim to sign out of, even when the
  recipe bundle is correctly signed.
- Recipe updates require an ECDSA P-256 signature from the pinned key, cannot roll back to
  an older version, and are revalidated before installation. Failure keeps the built-in
  recipes in place.

These boundaries are exercised by [tests/trust.test.mjs](tests/trust.test.mjs) and
[tests/bundle.test.mjs](tests/bundle.test.mjs), with additional cleanup, concurrency, and
hostile-input regressions. Site boundaries use a bundled full Public Suffix List, including
private hosting tenants; cookies are removed by explicit cookie identity rather than a
broader browsing-data cookie sweep. See [SECURITY.md](SECURITY.md) for the threat model,
remaining limits, and validation required before a public release.

## More documentation

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design constraints, rationale, and roadmap |
| [TESTING.md](TESTING.md) | Automated tests and manual browser checks |
| [PRIVACY.md](PRIVACY.md) | Privacy policy |
| [STORE.md](STORE.md) | Chrome Web Store notes and permission explanations |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [SECURITY.md](SECURITY.md) | Security boundaries, limits, and release gates |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Public Suffix List license and provenance |
