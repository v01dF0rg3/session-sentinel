/**
 * Stubs the chrome.* surface the UI touches, so the popup and options page can be
 * rendered and clicked in an ordinary browser tab. Dev harness only - never shipped.
 *
 * The fixture deliberately includes one of every outcome, so the honest-reporting path
 * (no unverified green revocation result) is exercised rather than assumed.
 */

(function () {
  const previewQuery = new URLSearchParams(location.search);
  // Render the real print rules on screen for visual QA where a native print dialog is
  // unavailable. This checks styling, not page breaks or physical printer behavior.
  if (previewQuery.get('print') === '1') {
    window.addEventListener('load', () => {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSMediaRule && rule.conditionText === 'print') rule.media.mediaText = 'screen';
        }
      }
    }, { once: true });
  }
  const settings = {
    version: 1,
    enabled: true,
    onboarded: false,
    onBrowserClose: { enabled: true, minTier: 'high' },
    onIdle: { enabled: true, minTier: 'critical', minutes: 30 },
    onLock: { enabled: true, minTier: 'high' },
    serverLogout: { enabled: true, minTier: 'high', timeoutMs: 20000 },
    depthByTier: { critical: 'deep', high: 'standard', medium: 'standard', low: 'cookies' },
    sites: { 'netflix.com': { mode: 'ignored' } },
    notifications: false,
    tabHandling: 'reload',
    compromisePrompt: 'high',
    recipeUpdates: {
      enabled: false,
      url: 'https://session-sentinel.pages.dev/recipes/bundle.json',
      lastCheck: 0,
      lastVersion: 0,
      lastError: ''
    }
  };

  const sites = [
    { domain: 'chase.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 14 },
    { domain: 'google.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 31 },
    { domain: 'github.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 9 },
    { domain: 'anytown.gov', tier: 'critical', tierReason: 'sensitive domain suffix', mode: 'default', cookieCount: 3 },
    { domain: 'slack.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 12 },
    { domain: 'linkedin.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 22 },
    { domain: 'netflix.com', tier: 'medium', tierReason: 'known site', mode: 'ignored', cookieCount: 7 },
    { domain: 'youtube.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 11 },
    { domain: 'somerandomblog.net', tier: 'low', tierReason: 'unclassified', mode: 'default', cookieCount: 2 },
    { domain: 'site001.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 2 },
    { domain: 'site002.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 3 },
    { domain: 'site003.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 4 },
    { domain: 'site004.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 5 },
    { domain: 'site005.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 6 },
    { domain: 'site006.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 7 },
    { domain: 'site007.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 8 },
    { domain: 'site008.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 9 },
    { domain: 'site009.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 1 },
    { domain: 'site010.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 2 },
    { domain: 'site011.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 3 },
    { domain: 'site012.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 4 },
    { domain: 'site013.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 5 },
    { domain: 'site014.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 6 },
    { domain: 'site015.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 7 },
    { domain: 'site016.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 8 },
    { domain: 'site017.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 9 },
    { domain: 'site018.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 1 },
    { domain: 'site019.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 2 },
    { domain: 'site020.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 3 },
    { domain: 'site021.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 4 },
    { domain: 'site022.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 5 },
    { domain: 'site023.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 6 },
    { domain: 'site024.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 7 },
    { domain: 'site025.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 8 },
    { domain: 'site026.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 9 },
    { domain: 'site027.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 1 },
    { domain: 'site028.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 2 },
    { domain: 'site029.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 3 },
    { domain: 'site030.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 4 },
    { domain: 'site031.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 5 },
    { domain: 'site032.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 6 },
    { domain: 'site033.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 7 },
    { domain: 'site034.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 8 },
    { domain: 'site035.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 9 },
    { domain: 'site036.com', tier: 'critical', tierReason: 'known site', mode: 'default', cookieCount: 1 },
    { domain: 'site037.com', tier: 'high', tierReason: 'known site', mode: 'default', cookieCount: 2 },
    { domain: 'site038.com', tier: 'medium', tierReason: 'known site', mode: 'default', cookieCount: 3 },
    { domain: 'site039.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 4 }
  ];

  const lastReport = {
    status: 'complete',
    pending: [],
    trigger: 'manual',
    startedAt: Date.now() - 9000,
    finishedAt: Date.now() - 2000,
    skipped: [{ domain: 'netflix.com', why: 'on your ignore list' }],
    sites: [
      { domain: 'github.com', tier: 'critical', outcome: 'cleared', detail: 'Local data cleared (deep); server-side invalidation was not verified.', tabsRefreshed: 1, verified: true, revokeGuidance: { kind: 'individual', url: 'https://github.com/settings/sessions', label: 'Web sessions', message: 'This site has no confirmed "sign out everywhere" button. Review the list and revoke unfamiliar sessions one at a time; do not assume a password change replaces this check.' } },
      { domain: 'google.com', tier: 'critical', outcome: 'logoutAttempted', detail: 'Site sign-out was attempted; server-side invalidation was not independently verified.', tabsRefreshed: 2, verified: true, revokeGuidance: { kind: 'page', url: 'https://myaccount.google.com/device-activity', label: 'Your devices', message: 'Other devices or copied tokens may still be active. Review this page and remove anything unfamiliar.' } },
      { domain: 'chase.com', tier: 'critical', outcome: 'cleared', detail: 'Local data cleared (deep); server-side invalidation was not verified.', tabsRefreshed: 0, verified: true, revokeGuidance: { kind: 'passwordOnly', message: 'No verified session-management page is known for this site. From a trusted device, review its security settings and verify active sessions separately.' } },
      { domain: 'slack.com', tier: 'high', outcome: 'failed', detail: 'could not clear local data', tabsRefreshed: 0, verified: false }
    ]
  };

  for (const site of lastReport.sites) {
    site.serverAction = site.outcome === 'logoutAttempted' ? 'attempted' : 'notAttempted';
    site.localCleanup = {
      status: site.outcome === 'failed' ? 'incomplete' : 'complete',
      cookies: site.outcome === 'failed' ? 'remaining' : 'cleared',
      remainingCookies: site.outcome === 'failed' ? 2 : 0,
      acceptedTypes: site.outcome === 'failed' ? [] : ['cookies', 'localStorage', 'serviceWorkers'],
      failedTypes: site.outcome === 'failed' ? ['cookies'] : [],
      knownOriginCount: 6,
      warnings: []
    };
  }
  if (previewQuery.get('run') === 'interrupted') {
    lastReport.status = 'running';
    lastReport.pending = ['unfinished.example', 'another.example'];
  }

  // Mirrors what the service worker derives from tabs, top sites and past runs. The real
  // partition is exercised by tests/relevance.test.mjs; this fixture exists so the popup
  // can be looked at against a profile of realistic size.
  const openNow = new Set(['youtube.com', 'github.com']);
  const frequentNow = new Set(['google.com', 'reddit.com']);
  // Signed-in is now the primary signal, and it is deliberately narrow: only a handful of
  // the fixture's domains carry anything resembling a real auth cookie. Being critical is
  // no longer enough on its own - that rule is what put aol.com on screen.
  const signedInNow = new Set(['github.com', 'google.com', 'youtube.com', 'chase.com', 'slack.com']);

  // Only evidence of an account qualifies. openNow and frequentNow order the list but no
  // longer join it - being on ebay.com's sign-in page is not being signed into ebay.com.
  sites.push({ domain: 'bloomberg.com', tier: 'low', tierReason: 'known site', mode: 'default', cookieCount: 5 });

  const usedDomains = sites
    .filter((s) => signedInNow.has(s.domain))
    .map((s) => s.domain);
  const configuredDomains = sites.filter((s) => s.mode === 'ignored' && !signedInNow.has(s.domain)).map((s) => s.domain);
  const questionDomains = ['bloomberg.com'];

  // The real overview attaches these via core/relevance.js. The preview needs the marker so
  // the separate review queue and its Login control are both exercised.
  for (const site of sites) {
    // After 0.27.1 almost everything starts as a question: a first-sight baseline can
    // contain the user's own auth cookie, so it may promote but never dismiss.
    site.reasons = signedInNow.has(site.domain) ? ['signed in here'] : [];
    site.needsConfirmation = questionDomains.includes(site.domain);
  }

  const overview = () => ({
    settings,
    sites,
    currentDomain: 'youtube.com',
    lastReport,
    relevance: {
      used: usedDomains,
      confirmed: [...signedInNow],
      configured: configuredDomains,
      questions: questionDomains,
      questionCount: questionDomains.length,
      otherCount: sites.length - usedDomains.length - questionDomains.length,
      narrowed: sites.length > usedDomains.length,
      canRankByFrequency: settings.useVisitFrequency,
    },
    recipeStatus: { total: 3, source: 'built-in', bundleVersion: null, fetchedAt: null },
    crashTrail: crashTrail.value
  });

  const recovery = { done: [], minTier: 'high', startedAt: Date.now() };

  const crashTrail = {
    value: previewQuery.get('run') === 'interrupted' ? {
      step: 'wipe',
      description: 'clearing cookies for this site',
      domain: 'youtube.com',
      at: Date.now() - 60000
    } : null
  };

  const delay = (value, ms = 350) => new Promise((r) => setTimeout(() => r(value), ms));

  // --- extra surface so the diagnostics page can be exercised in the harness ------
  // One data type deliberately rejects origin scoping, so the failure path renders too.
  const store = { local: {}, session: {} };
  const area = (bag) => ({
    get: (k) => delay(typeof k === 'string' ? { [k]: bag[k] } : bag, 5),
    set: (o) => { Object.assign(bag, o); return delay(undefined, 5); },
    remove: (k) => { delete bag[k]; return delay(undefined, 5); }
  });

  globalThis.chrome = {
    storage: { local: area(store.local), session: area(store.session) },
    permissions: { request: () => delay(true, 200), contains: () => delay(false, 10), getAll: () => delay({ permissions: ['storage','alarms','idle','cookies','browsingData','scripting','tabs','notifications'], origins: ['<all_urls>'] }, 10) },
    idle: { queryState: () => delay('active', 10) },
    alarms: {
      create: () => delay(undefined, 5),
      get: () => delay({ name: '__selftest' }, 5),
      clear: () => delay(true, 5)
    },
    cookies: {
      getAll: () => delay([
        { name: 'sessionid', domain: '.github.com', path: '/', secure: true, httpOnly: true },
        { name: '__Secure-1PSID', domain: '.google.com', path: '/', secure: true, httpOnly: true },
        { name: '_ga', domain: '.example.com', path: '/', secure: false, httpOnly: false, expirationDate: 1e10 }
      ], 15),
      getAllCookieStores: () => delay([{ id: '0' }], 5),
      remove: () => delay(undefined, 5)
    },
    browsingData: {
      remove: (_scope, types) =>
        types.fileSystems
          ? Promise.reject(new Error('fileSystems does not support origin filtering'))
          : delay(undefined, 8)
    },
    windows: {
      create: () => delay({ id: 99 }, 20),
      get: () => delay({ id: 99, state: 'minimized' }, 5),
      remove: () => delay(undefined, 5),
      getAll: () => delay([{ id: 1 }], 5)
    },
    tabs: {
      create: () => delay({ id: 1234 }, 20),
      get: () => delay({ id: 1234, status: 'complete', url: 'https://example.com/' }, 5),
      remove: () => delay(undefined, 5),
      query: () => delay([{ id: 1234, url: 'https://youtube.com/watch?v=x' }], 5)
    },
    scripting: { executeScript: () => delay([{ result: { ok: true, detail: 'found' } }], 20) },
    notifications: { create: () => delay('n1', 10), clear: () => delay(true, 5) },
    runtime: {
      getManifest: () => ({ version: '0.36.2', permissions: ['storage','alarms','idle','cookies','browsingData','scripting','tabs','notifications'] }),
      async sendMessage(message) {
        if (previewQuery.get('recovery') === 'save-error' && ['markRecoveryStep', 'setRecoveryScope', 'resetRecovery'].includes(message?.type)) {
          return delay({ error: 'Recovery fixture: storage unavailable' }, 20);
        }
        switch (message?.type) {
          case 'getOverview':
            return delay(overview(), 60);

          case 'getSettings':
            return delay(settings, 20);

          case 'updateSettings':
            Object.assign(settings, message.patch);
            return delay(settings, 20);

          case 'setSiteOverride': {
            const site = sites.find((s) => s.domain === message.domain);
            if (site) site.mode = message.override?.mode ?? 'default';
            if (message.override) settings.sites[message.domain] = message.override;
            else delete settings.sites[message.domain];
            return delay(settings, 20);
          }

          case 'getRecovery': {
            const fixture = previewQuery.get('recovery');
            if (fixture === 'error') throw new Error('Recovery fixture: worker unavailable');
            const all = [
              { domain: 'google.com', tier: 'critical', category: 'identity', passwordUrl: 'https://myaccount.google.com/signinoptions/password', siteUrl: 'https://google.com', sessionsUrl: 'https://myaccount.google.com/device-activity', sessionsLabel: 'Your devices', sharesSignInWith: ['youtube.com'] },
              { domain: 'aol.com', tier: 'critical', category: 'identity', siteUrl: 'https://aol.com', sharesSignInWith: [] },
              { domain: 'chase.com', tier: 'critical', category: 'finance', siteUrl: 'https://chase.com', sharesSignInWith: [] },
              { domain: 'breadpayments.com', tier: 'critical', category: 'finance', siteUrl: 'https://breadpayments.com', sharesSignInWith: [] },
              { domain: 'github.com', tier: 'critical', category: 'infrastructure', passwordUrl: 'https://github.com/settings/security', siteUrl: 'https://github.com', sessionsUrl: 'https://github.com/settings/sessions', sessionsLabel: 'Web sessions', sharesSignInWith: [] },
              { domain: 'azure.com', tier: 'critical', category: 'infrastructure', siteUrl: 'https://azure.com', sharesSignInWith: [] },
              { domain: 'discord.com', tier: 'critical', category: 'communication', siteUrl: 'https://discord.com', sessionsUrl: 'https://discord.com/channels/@me', sessionsLabel: 'Settings, Devices', sharesSignInWith: [] },
              { domain: 'linkedin.com', tier: 'high', category: 'communication', passwordUrl: 'https://www.linkedin.com/psettings/change-password', siteUrl: 'https://linkedin.com', sharesSignInWith: [] },
              { domain: 'chess.com', tier: 'low', category: 'other', siteUrl: 'https://chess.com', sharesSignInWith: [] },
              { domain: 'bloomberg.com', tier: 'low', category: 'other', siteUrl: 'https://bloomberg.com', sharesSignInWith: [], unverified: true }
            ].map((step) => ({ ...step, unverified: step.unverified === true }));
            if (fixture === 'empty') all.length = 0;
            if (fixture === 'large') {
              all.push(...Array.from({ length: 100 }, (_, i) => ({
                domain: `recovery-fixture-${i + 1}.com`, tier: 'low', category: 'other',
                siteUrl: `https://recovery-fixture-${i + 1}.com`, sharesSignInWith: [], unverified: false
              })));
            }
            const labels = { identity: 'Email and identity', finance: 'Money', infrastructure: 'Infrastructure and code', communication: 'Communication and social', other: 'Everything else' };
            const whys = {
              identity: 'Review these first. Email and identity accounts can reset or unlock many other accounts, so leaving them compromised can undo later recovery work.',
              finance: 'Direct loss. Stored cards, transfers, and anything that can move money.',
              infrastructure: 'Lasting damage. Code, deployments, domains and cloud accounts can be altered in ways that outlive the breach.',
              communication: 'Impersonation, and a reset vector of their own for anything tied to these accounts.',
              other: 'Lower stakes, but still worth reviewing once the rest is done.'
            };
            const fullGroups = ['identity','finance','infrastructure','communication','other'].map((c) => ({
              category: c, label: labels[c], why: whys[c], steps: all.filter((s) => s.category === c)
            }));
            const minTier = message.minTier ?? recovery.minTier;
            const ranks = { critical: 3, high: 2, medium: 1, low: 0 };
            const groups = fullGroups.map((group) => ({ ...group, steps: group.steps.filter((s) => ranks[s.tier] >= ranks[minTier]) })).filter((group) => group.steps.length);
            const { createRecoveryHandoff } = await import('../src/core/recovery-handoff.js');
            const flat = groups.flatMap((g) => g.steps.map((s) => s.domain));
            return delay({
              groups,
              handoff: createRecoveryHandoff(fullGroups),
              state: { ...recovery, minTier },
              progress: {
                done: flat.filter((d) => recovery.done.includes(d)).length,
                total: flat.length,
                nextDomain: flat.find((d) => !recovery.done.includes(d)) ?? null
              }
            }, 40);
          }

          // Real measured answers, so the preview shows the mix the user will actually
          // see: some found, some not. discord.com and chase.com genuinely do not serve
          // the well-known endpoint, and pretending otherwise would flatter the feature.
          case 'findPasswordPages':
            return delay(
              Object.fromEntries(
                (message.domains ?? [])
                  .filter((d) => ['aol.com', 'azure.com'].includes(d))
                  .map((d) => [d, `https://${d}/.well-known/change-password`])
              ),
              600
            );

          case 'markRecoveryStep': {
            const set = new Set(recovery.done);
            if (message.done) set.add(message.domain); else set.delete(message.domain);
            recovery.done = [...set];
            return delay({ ...recovery }, 20);
          }

          case 'setRecoveryScope':
            recovery.minTier = message.minTier;
            return delay({ ...recovery }, 20);

          case 'resetRecovery':
            recovery.done = [];
            return delay({ ok: true }, 20);

          case 'getCoverage': {
            const entries = [
              { domain: 'github.com', outcome: 'logoutAttempted', method: 'recipe', attempted: true, at: Date.now()-8e6, runs: 3 },
              { domain: 'google.com', outcome: 'logoutAttempted', method: 'recipe', attempted: true, at: Date.now()-7e6, runs: 2 },
              { domain: 'vast.ai', outcome: 'logoutAttempted', method: 'home', attempted: true, at: Date.now()-6e6, runs: 1 },
              { domain: 'proton.me', outcome: 'logoutAttempted', method: 'path', attempted: true, at: Date.now()-5e6, runs: 1 },
              { domain: 'linear.app', outcome: 'logoutAttempted', method: 'path', attempted: true, at: Date.now()-4e6, runs: 1 },
              { domain: 'chase.com', outcome: 'cleared', method: 'none', attempted: true, at: Date.now()-3e6, runs: 2 },
              { domain: 'breadpayments.com', outcome: 'cleared', method: 'none', attempted: true, at: Date.now()-2e6, runs: 1 },
              { domain: 'somerandomblog.net', outcome: 'cleared', method: 'none', attempted: false, at: Date.now()-1e6, runs: 1 }
            ];
            const byMethod = {};
            let attempted=0, reached=0, cleared=0;
            const verifiedRevoked = 0;
            const needs=[];
            for (const e of entries) {
              if (!e.attempted) continue;
              attempted++;
              byMethod[e.method] = (byMethod[e.method]??0)+1;
              if (e.outcome==='logoutAttempted'||e.outcome==='revoked') {
                reached++;
              } else { cleared++; needs.push(e); }
            }
            return delay({ entries, summary: {
              total: entries.length, attempted, logoutReached: reached, verifiedRevoked, clearedOnly: cleared, failed: 0,
              reachRate: Math.round((reached/attempted)*100), byMethod,
              needsRecipe: needs.sort((a,b)=>b.at-a.at)
            }}, 30);
          }

          case 'clearCoverage':
            return delay({ ok: true }, 20);

          case 'getEventLog':
            return delay([
              { t: Date.now() - 9000, type: 'run:start', detail: 'manualSite' },
              { t: Date.now() - 8500, type: 'step:wipe', detail: 'youtube.com' },
              { t: Date.now() - 8000, type: 'step:verify', detail: 'youtube.com' },
              { t: Date.now() - 7800, type: 'run:complete', detail: '1 site(s)' },
              { t: Date.now() - 2000, type: 'browser:startup', detail: '' }
            ], 30);

          // Real names, including the one that caused the bug, so the panel is checked
          // against the case it exists to explain.
          case 'explainSignedIn':
            return delay([
              { domain: 'chase.com', strong: ['JSESSIONID'], moderate: [] },
              { domain: 'github.com', strong: ['user_session', '__Host-user_session_same_site'], moderate: [] },
              { domain: 'google.com', strong: ['__Secure-1PSID', 'SSID'], moderate: [] },
              { domain: 'slack.com', strong: ['d'], moderate: ['x'] }
            ], 60);

          case 'setSiteVerdict':
            if (message.verdict === 'notMine') {
              const i = sites.findIndex((x) => x.domain === message.domain);
              if (i >= 0) sites.splice(i, 1);
            }
            return delay({ ok: true }, 20);

          case 'openLogin':
            return delay({ ok: true, tabId: 1234 }, 20);

          case 'clearEventLog':
            return delay({ ok: true }, 10);

          case 'dismissCrashReport':
            crashTrail.value = null;
            return delay({ ok: true }, 20);

          case 'refreshRecipes':
            settings.recipeUpdates = { ...settings.recipeUpdates, lastCheck: Date.now(), lastError: 'Failed to fetch' };
            return delay({ updated: false, error: 'bundle host returned 404' }, 600);

          case 'runNow':
            return delay(lastReport, 900);

          case 'runSite':
          case 'clearSite':
            return delay({
              trigger: 'manualSite',
              startedAt: Date.now(),
              finishedAt: Date.now(),
              skipped: [],
              sites: [{
                domain: message.domain,
                tier: 'critical',
                outcome: message.type === 'clearSite' ? 'cleared' : 'logoutAttempted',
                detail: message.type === 'clearSite'
                  ? 'Local data cleared in preview fixture.'
                  : 'Site sign-out attempted in preview fixture; revocation not verified.',
                tabsRefreshed: 1,
                verified: true
              }]
            }, 700);

          default:
            return Promise.reject(new Error(`stub: unknown message ${message?.type}`));
        }
      },
      openOptionsPage() {
        location.href = './options-preview.html';
      },
      getURL: (path) => {
        const page = /^src\/ui\/(popup|options|welcome|recovery|diagnostics)\.html$/.exec(path);
        return page ? `/dev/${page[1]}-preview.html` : `/${path}`;
      }
    }
  };
})();
