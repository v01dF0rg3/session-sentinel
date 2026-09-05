/**
 * Settings shape, defaults, and the resolution rules that turn "a site" into
 * "what we are allowed to do to it right now". Pure - no chrome.* here.
 *
 * The defaults are the whole product for a user who never opens the options page:
 * critical and high tiers get automatic local cleanup, and everything else is left alone
 * until the user asks. A zero-config extension that nukes IndexedDB on
 * every site at browser close destroys someone's unsaved work on day one and gets
 * uninstalled, so "protect everything" is offered as one toggle rather than assumed.
 */

/** @typedef {import('./risk.js').RiskTier} RiskTier */
/** @typedef {'cookies' | 'standard' | 'deep'} WipeDepth */
/** @typedef {'default' | 'protected' | 'ignored'} SiteMode */

/**
 * @typedef {object} SiteOverride
 * @property {SiteMode} mode
 * @property {RiskTier} [tier] Manual reclassification.
 */

/**
 * @typedef {object} Settings
 * @property {number} version
 * @property {boolean} enabled Master switch.
 * @property {boolean} onboarded The user has seen what the automatic triggers will do.
 * @property {{ enabled: boolean, minTier: RiskTier }} onBrowserClose
 * @property {{ enabled: boolean, minTier: RiskTier, minutes: number }} onIdle
 * @property {{ enabled: boolean, minTier: RiskTier }} onLock
 * @property {{ enabled: boolean, minTier: RiskTier, timeoutMs: number }} serverLogout
 * @property {Record<RiskTier, WipeDepth>} depthByTier
 * @property {Record<string, SiteOverride>} sites Keyed by registrable domain.
 * @property {boolean} notifications
 * @property {'none' | 'reload'} tabHandling What to do with your open tabs on a cleared site.
 * @property {'high' | 'always' | 'never'} compromisePrompt When to offer the trusted-device
 *   recovery route before attempting sign-out.
 * @property {boolean} useVisitFrequency Order equally-risky confirmed accounts by how often
 *   they are used. Never confirms one. Requires the optional topSites permission.
 * @property {{ enabled: boolean, url: string, lastCheck: number, lastVersion: number, lastError: string }} recipeUpdates
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  version: 7,
  enabled: true,

  // False until the welcome screen has been acknowledged. Automatic triggers are held
  // back until then: a freshly installed extension that silently signs you out of your
  // bank the first time you close the browser reads as the browser breaking, not as a
  // feature working. Manual actions are available immediately.
  onboarded: false,

  // Wipe on close covers the two tiers where a stolen cookie is a genuine incident.
  onBrowserClose: { enabled: true, minTier: 'high' },

  // 30 minutes idle is long enough not to interrupt real work, short enough to matter
  // on a shared or unattended machine.
  onIdle: { enabled: true, minTier: 'critical', minutes: 30 },

  // Screen lock is an explicit "I am walking away" signal, so it is treated harder.
  onLock: { enabled: true, minTier: 'high' },

  // A site sign-out attempt costs a background tab and a few seconds, so it is reserved
  // for the tiers where giving the site an opportunity to invalidate the token matters.
  serverLogout: { enabled: true, minTier: 'high', timeoutMs: 20000 },

  depthByTier: {
    critical: 'deep',
    high: 'standard',
    medium: 'standard',
    low: 'cookies'
  },

  sites: {},

  // Off by default as of settings version 2. A run that had already finished and saved
  // its report was still ending the browser session, and the notification is the last
  // thing a run does - which makes it the prime suspect. It is a cosmetic feature, so
  // switching it off costs almost nothing while the crash breadcrumb confirms or clears
  // it. Re-enable freely in settings.
  notifications: false,

  // Reload open tabs on a site once it has been cleared.
  //
  // Without this a page already on screen may keep old state in memory and carry on
  // showing an avatar and signed-in menu after local cleanup. Reloading updates the view;
  // it does not prove remote invalidation.
  //
  // The browser crash that haunted earlier versions came from forcing tabs to about:blank,
  // which no longer happens anywhere. `tabs.reload` is the same operation as pressing F5.
  tabHandling: /** @type {'none' | 'reload'} */ ('reload'),

  // Before attempting sign-out on a high-risk site, offer the trusted-device recovery
  // route, including session review, password settings, MFA, and recovery methods.
  //
  // Briefly defaulted to every site, on the grounds that silently logging someone out of a
  // compromised account is worse than a prompt they ignore. The "Been hacked?" walkthrough
  // changed that calculation: there is now a permanent, discoverable route to the same
  // advice, so the interruption no longer has to carry the whole message. High-risk sites
  // keep the prompt because that is where a wrong move costs most.
  compromisePrompt: /** @type {'high' | 'always' | 'never'} */ ('high'),

  // Off, and an optional permission, because a privacy tool does not get to quietly widen
  // its own access. Frequency never changes a risk tier - a news site read daily is not
  // more dangerous to lose than a bank visited twice a year - it only breaks ties between
  // accounts that are already equally sensitive.
  useVisitFrequency: false,

  // Off until a bundle host is actually published. A feature that silently fails its
  // weekly check is worse than one honestly switched off, and leaving it on would train
  // the user to ignore a permanent error.
  recipeUpdates: {
    enabled: false,
    url: 'https://session-sentinel.pages.dev/recipes/bundle.json',
    lastCheck: 0,
    lastVersion: 0,
    lastError: ''
  }
};

/**
 * Data types requested at each depth. Cookies use the explicit cookies API; the other
 * types use origin-scoped `chrome.browsingData` calls.
 *
 * `sessionStorage` and live page memory are not cleared by this path; user tabs are never
 * closed. HTTP `cache` and `history` are deliberately excluded from session cleanup.
 *
 * @type {Record<WipeDepth, string[]>}
 */
export const DEPTH_DATA_TYPES = {
  cookies: ['cookies'],
  standard: ['cookies', 'localStorage', 'serviceWorkers'],
  deep: ['cookies', 'localStorage', 'serviceWorkers', 'indexedDB', 'cacheStorage', 'fileSystems']
};

/**
 * Merge stored settings over the defaults. Missing keys resolve to defaults so a
 * partially-written or older settings blob never leaves the engine in a null state.
 * @param {Partial<Settings> | undefined} stored
 * @returns {Settings}
 */
export function withDefaults(stored) {
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    onBrowserClose: { ...DEFAULT_SETTINGS.onBrowserClose, ...stored.onBrowserClose },
    onIdle: { ...DEFAULT_SETTINGS.onIdle, ...stored.onIdle },
    onLock: { ...DEFAULT_SETTINGS.onLock, ...stored.onLock },
    serverLogout: { ...DEFAULT_SETTINGS.serverLogout, ...stored.serverLogout },
    depthByTier: { ...DEFAULT_SETTINGS.depthByTier, ...stored.depthByTier },
    sites: { ...DEFAULT_SETTINGS.sites, ...stored.sites },
    recipeUpdates: { ...DEFAULT_SETTINGS.recipeUpdates, ...stored.recipeUpdates }
  };
}
