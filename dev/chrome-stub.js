/**
 * Stubs the chrome.* surface the UI touches, so the popup and options page can be
 * rendered and clicked in an ordinary browser tab. Dev harness only - never shipped.
 *
 * The fixture deliberately includes one of every outcome, so the honest-reporting path
 * (green only for 'revoked') is exercised rather than assumed.
 */

(function () {
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
    trigger: 'manual',
    startedAt: Date.now() - 9000,
    finishedAt: Date.now() - 2000,
    skipped: [{ domain: 'netflix.com', why: 'on your ignore list' }],
    sites: [
      { domain: 'github.com', tier: 'critical', outcome: 'cleared', detail: 'local data cleared (deep)', tabsRefreshed: 1, verified: true, revokeGuidance: { kind: 'individual', url: 'https://github.com/settings/sessions', label: 'Web sessions', message: 'This site has no "sign out everywhere" button — sessions must be revoked one at a time from the list, or ended all at once by changing your password.' } },
      { domain: 'google.com', tier: 'critical', outcome: 'loggedOut', detail: 'Ends the browser session properly instead of orphaning it.', tabsRefreshed: 2, verified: true, revokeGuidance: { kind: 'page', url: 'https://myaccount.google.com/device-activity', label: 'Your devices', message: 'Other devices may still be signed in. Revoke them from the page below if it offers it; changing your password is the reliable fallback.' } },
      { domain: 'chase.com', tier: 'critical', outcome: 'cleared', detail: 'local data cleared (deep)', tabsRefreshed: 0, verified: true, revokeGuidance: { kind: 'passwordOnly', message: 'No way to sign out other devices is known for this site. Check its account security settings — and if there is nothing there, changing your password is usually the only thing that ends sessions elsewhere.' } },
      { domain: 'slack.com', tier: 'high', outcome: 'failed', detail: 'could not clear local data', tabsRefreshed: 0, verified: false }
    ]
  };

  const overview = () => ({
    settings,
    sites,
    currentDomain: 'youtube.com',
    lastReport,
    recipeStatus: { total: 3, source: 'built-in', bundleVersion: null, fetchedAt: null },
    crashTrail: crashTrail.value
  });

  const recovery = { done: [], minTier: 'high', startedAt: Date.now() };

  const crashTrail = {
    value: {
      step: 'wipe',
      description: 'clearing cookies for this site',
      domain: 'youtube.com',
      at: Date.now() - 60000
    }
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
    permissions: { getAll: () => delay({ permissions: ['storage','alarms','idle','cookies','browsingData','scripting','tabs','notifications'], origins: ['<all_urls>'] }, 10) },
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
      getManifest: () => ({ version: '0.4.0', permissions: ['storage','alarms','idle','cookies','browsingData','scripting','tabs','notifications'] }),
      sendMessage(message) {
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
            const all = [
              { domain: 'google.com', tier: 'critical', category: 'identity', passwordUrl: 'https://myaccount.google.com/signinoptions/password', siteUrl: 'https://google.com', sessionsUrl: 'https://myaccount.google.com/device-activity', sessionsLabel: 'Your devices', sharesSignInWith: ['youtube.com'] },
              { domain: 'aol.com', tier: 'critical', category: 'identity', siteUrl: 'https://aol.com', sharesSignInWith: [] },
              { domain: 'chase.com', tier: 'critical', category: 'finance', siteUrl: 'https://chase.com', sharesSignInWith: [] },
              { domain: 'breadpayments.com', tier: 'critical', category: 'finance', siteUrl: 'https://breadpayments.com', sharesSignInWith: [] },
              { domain: 'github.com', tier: 'critical', category: 'infrastructure', passwordUrl: 'https://github.com/settings/security', siteUrl: 'https://github.com', sessionsUrl: 'https://github.com/settings/sessions', sessionsLabel: 'Web sessions', sharesSignInWith: [] },
              { domain: 'azure.com', tier: 'critical', category: 'infrastructure', siteUrl: 'https://azure.com', sharesSignInWith: [] },
              { domain: 'discord.com', tier: 'critical', category: 'communication', siteUrl: 'https://discord.com', sessionsUrl: 'https://discord.com/channels/@me', sessionsLabel: 'Settings, Devices', sharesSignInWith: [] },
              { domain: 'linkedin.com', tier: 'high', category: 'communication', passwordUrl: 'https://www.linkedin.com/psettings/change-password', siteUrl: 'https://linkedin.com', sharesSignInWith: [] }
            ];
            const labels = { identity: 'Email and identity', finance: 'Money', infrastructure: 'Infrastructure and code', communication: 'Communication and social' };
            const whys = {
              identity: 'Secure these first. Every other account can be reset through them, so anything you fix before these can simply be taken again.',
              finance: 'Direct loss. Stored cards, transfers, and anything that can move money.',
              infrastructure: 'Lasting damage. Code, deployments, domains and cloud accounts can be altered in ways that outlive the breach.',
              communication: 'Impersonation, and a reset vector of their own for anything tied to these accounts.'
            };
            const groups = ['identity','finance','infrastructure','communication'].map((c) => ({
              category: c, label: labels[c], why: whys[c], steps: all.filter((s) => s.category === c)
            }));
            const flat = groups.flatMap((g) => g.steps.map((s) => s.domain));
            return delay({
              groups,
              state: { ...recovery },
              progress: {
                done: flat.filter((d) => recovery.done.includes(d)).length,
                total: flat.length,
                nextDomain: flat.find((d) => !recovery.done.includes(d)) ?? null
              }
            }, 40);
          }

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

          case 'getEventLog':
            return delay([
              { t: Date.now() - 9000, type: 'run:start', detail: 'manualSite' },
              { t: Date.now() - 8500, type: 'step:wipe', detail: 'youtube.com' },
              { t: Date.now() - 8000, type: 'step:verify', detail: 'youtube.com' },
              { t: Date.now() - 7800, type: 'run:complete', detail: '1 site(s)' },
              { t: Date.now() - 2000, type: 'browser:startup', detail: '' }
            ], 30);

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
                outcome: message.type === 'clearSite' ? 'cleared' : 'revoked',
                detail: 'fixture',
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
      getURL: (path) => `/${path}`
    }
  };
})();
