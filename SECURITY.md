# Security model and release checks

Session Sentinel is a containment and recovery aid. It is not antivirus, a trusted session
inventory, or proof that stolen tokens have stopped working. No independent security audit
or stolen-token invalidation validation is claimed for v0.36.x.

## What this version can establish

- Whether a website sign-out route or control was reached. That is an **attempt**.
- Whether any cookies were visible for the selected site in the normal Chrome profile at
  readback, including partitioned cookies. This is a point-in-time local observation.
- Which storage-removal requests Chrome accepted for known origins and which failed.
  Storage contents are not independently read back.
- Which sites have completed results and which were unfinished at the last checkpoint.

Past recipe observations, a successful click, a disappeared cookie, and a hidden account
menu are not evidence that the server rejects a copied token. Legacy `revoked` results are
displayed as unverified attempts. No current recipe can return verified remote revocation.

## Boundaries enforced in code

- **Selected site:** full ICANN + PRIVATE suffix rules separate registrable sites and hosted
  tenants. Invalid or bare-suffix cleanup targets are refused.
- **Exact cookies:** deletion specifies each cookie's URL, name, store, and partition key.
  It never uses the broader `browsingData` cookie sweep. Missing access fails closed.
- **Known storage origins:** cleanup includes base/www origins plus matching cookie-host
  and open-tab origins, captured before sign-out can remove those hints. It never widens a
  failed storage call to all sites.
- **Normal profile:** no automatic sweep of Incognito or other profile stores. Private
  windows and tabs are excluded from normal work; Incognito popup cleanup is unsupported.
- **Page automation:** HTTPS same-site navigation, landing checks, and exact-origin guards
  before DOM actions. Cross-origin links/form destinations and ambiguous generic confirm
  controls are refused. An unrelated site cannot authorize clicks into an IdP account.
- **Commands and updates:** privileged messages require a named packaged extension UI page;
  recipes require schema/navigation validation and downloaded bundles require a pinned-key
  signature and rollback checks. No remotely supplied script is executed.
- **Interrupted work:** one live worker run at a time, persisted checkpoints, and retained
  failed startup targets. Alarms do not guarantee worker lifetime or automatic manual resumption.
- **User choices:** manual bulk sign-out stays confirmed-only; Keep rules remain enforced.
  Existing automatic triggers use the broader candidate scope described in the README.

## What remains outside those boundaries

Active malware can steal new credentials, modify extension data, interfere with execution,
or alter a recovery plan. Use a known-clean device for recovery. Browser permissions cannot
make an infected operating system trustworthy.

Unseen storage-only origins, sessionStorage, live page memory, native-app credentials,
other profiles/devices, provider refresh tokens, and already-copied tokens are not verified
safe. An open page or shared sign-in provider can recreate cookies after a check. Sites
control their own JavaScript click handlers; an origin check is not a page-integrity audit.
Domain-level evidence also cannot distinguish every account used on the same service.

## Before public distribution

The automated suite and local Chrome preview are necessary, not sufficient. Record these
checks on the exact packaged build using disposable accounts and a separate Chrome profile:

1. Run installed diagnostics. Confirm both ordinary and partitioned public cookie canaries
   are created, removed, and absent afterward. Test on the minimum supported Chrome and a
   current stable version, not just API fakes.
2. Verify sibling-tenant isolation, Keep rules, confirmed-only bulk scope, missing permission
   handling, and Incognito non-interference. Populate disposable storage before cleanup;
   a successful request against an empty origin is not a deletion test.
3. Interrupt a run and force partial failures. Verify honest checkpoints, pending startup
   retry retention, and access to recovery controls even when the popup report is long.
4. Measure provider behavior with throwaway accounts. Distinguish an independent second
   session from a copied token of the first session. Record exactly what was tested; do not
   export production tokens, or upgrade runtime labels based on historical observations.
5. Review permissions, dependency/list provenance, signature handling, recovery guidance,
   and the release diff. Obtain an independent security review before broad safety claims.

See [TESTING.md](TESTING.md) for the detailed checklist. No release tag, green unit test,
or diagnostic pass establishes that users' remote sessions are safe.

## Reporting a vulnerability

For a non-sensitive bug, use the repository's issue tracker. Do not post passwords,
cookies, tokens, account identifiers, or personal browsing reports in a public issue.
For a security flaw, use GitHub's **Report a vulnerability** option if enabled. If it is
unavailable, request a private reporting channel without publishing exploit details or
secrets. A public issue is not a private disclosure channel.
