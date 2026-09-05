/**
 * Popup. Renders the overview, dispatches actions, and reports outcomes honestly -
 * local observations never imply remote token revocation.
 */

import { localEvidenceText, summarize } from '../engine/report.js';
import { compromiseAdviceFor } from '../core/session-pages.js';
import { atLeast } from '../core/risk.js';
import { groupByTier } from '../core/relevance.js';
import { createSignoutPrompt } from './signout-prompt.js';
import { accountGroups, automationState, compactResult, createPopupTabs } from './popup-view.js';

/** @type {any} */
let overview = null;
let actionInProgress = false;
let displayedReport = null;
let runningPoll = null;
let observedRunning = false;

const el = {
  content: document.querySelector('.popup-content'),
  status: /** @type {HTMLElement} */ (document.getElementById('status')),
  statusText: document.getElementById('status-text'),
  statusDetail: document.getElementById('status-detail'),
  statusView: document.getElementById('status-view'),
  statusDismiss: document.getElementById('status-dismiss'),
  runMessage: document.getElementById('run-message'),
  revokeGuidance: document.getElementById('revoke-guidance'),
  activityEmpty: document.getElementById('activity-empty'),
  activityPreview: document.getElementById('activity-preview'),
  activityPreviewText: document.getElementById('activity-preview-text'),
  activityDot: document.getElementById('activity-dot'),
  navAccountCount: document.getElementById('nav-account-count'),
  homeScope: document.getElementById('home-scope'),
  listTitle: document.getElementById('list-title'),
  accountHelp: document.getElementById('account-help'),
  noCurrent: document.getElementById('no-current'),
  currentKept: document.getElementById('current-kept'),
  logoutAllLabel: document.getElementById('logout-all-label'),
  runEvidence: document.getElementById('run-evidence'),
  runEvidenceTitle: document.getElementById('run-evidence-title'),
  runEvidenceSites: document.getElementById('run-evidence-sites'),
  siteList: /** @type {HTMLUListElement} */ (document.getElementById('site-list')),
  listActions: /** @type {HTMLElement} */ (document.getElementById('list-actions')),
  siteCount: /** @type {HTMLElement} */ (document.getElementById('site-count')),
  lastRun: /** @type {HTMLElement} */ (document.getElementById('last-run')),
  logoutAll: /** @type {HTMLButtonElement} */ (document.getElementById('logout-all')),
  scopeHint: /** @type {HTMLElement} */ (document.getElementById('scope-hint')),
  current: /** @type {HTMLElement} */ (document.getElementById('current-site')),
  currentDomain: /** @type {HTMLElement} */ (document.getElementById('current-domain')),
  currentTier: /** @type {HTMLElement} */ (document.getElementById('current-tier')),
  logoutCurrent: /** @type {HTMLButtonElement} */ (document.getElementById('logout-current')),
  clearCurrent: /** @type {HTMLButtonElement} */ (document.getElementById('clear-current')),
  keepCurrent: /** @type {HTMLInputElement} */ (document.getElementById('keep-current')),
  toggleEnabled: /** @type {HTMLButtonElement} */ (document.getElementById('toggle-enabled')),
  enabledLabel: /** @type {HTMLElement} */ (document.getElementById('enabled-label')),
  openOptions: /** @type {HTMLButtonElement} */ (document.getElementById('open-options')),
  openRecovery: /** @type {HTMLButtonElement} */ (document.getElementById('open-recovery')),
  filter: /** @type {HTMLInputElement} */ (document.getElementById('site-filter')),
  crashReport: /** @type {HTMLElement} */ (document.getElementById('crash-report')),
  crashDetail: /** @type {HTMLElement} */ (document.getElementById('crash-detail')),
  crashDismiss: /** @type {HTMLButtonElement} */ (document.getElementById('crash-dismiss'))
};

/** Current text in the filter box. Kept out of `overview` so re-renders preserve it. */
let filterText = '';

let accountCategory = 'confirmed';
const tabs = createPopupTabs(document.body);

const signoutPrompt = createSignoutPrompt(document.getElementById('signout-dialog'), {
  onConfirm: (domain) => act(`Attempting sign-out of ${domain}...`, { type: 'runSite', domain }),
  onRecovery: () => openAdvicePage(chrome.runtime.getURL('src/ui/recovery.html'),
    'Opened the recovery checklist. If malware may be active on this computer, continue from another device you trust.'),
  onSessions: (url, domain) => openAdvicePage(url,
    `Opened session settings for ${domain}. Session Sentinel has not started sign-out. Review sessions from a trusted device.`)
});

async function openAdvicePage(url, message) {
  try {
    await chrome.tabs.create({ url });
    setStatus(message, 'amber');
  } catch (error) {
    setStatus(`Could not open the page: ${error instanceof Error ? error.message : String(error)}`, 'red');
  }
  revealStatus();
}

/**
 * @param {any} message
 * @returns {Promise<any>}
 */
function send(message) {
  return chrome.runtime.sendMessage({ ...message, incognitoContext: chrome.extension?.inIncognitoContext === true });
}

/**
 * @param {string} text
 * @param {'neutral' | 'amber' | 'red' | 'busy'} tone
 */
function setStatus(text, tone, detail = '', hasDetails = false) {
  el.status.hidden = false;
  el.status.className = `status ${tone}`;
  el.statusText.textContent = text;
  el.statusDetail.textContent = detail;
  el.statusDetail.hidden = !detail;
  el.statusView.hidden = !hasDetails;
  el.statusDismiss.hidden = tone === 'busy';
}

function revealStatus() {
  el.status.focus({ preventScroll: true });
}

async function load() {
  clearTimeout(runningPoll);
  try {
    overview = await send({ type: 'getOverview' });
    render();
    if (overview.error) return false;
    if (overview.runInProgress && !actionInProgress) {
      observedRunning = true;
      const result = compactResult(displayedReport, true);
      setStatus(result.title, result.tone, result.detail, true);
      // Only while an already-running cleanup is visible. Closing the popup ends polling.
      runningPoll = setTimeout(load, 1200);
    } else if (observedRunning && !actionInProgress) {
      observedRunning = false;
      showResult(displayedReport);
    }
    return true;
  } catch (error) {
    showOverviewError(`Could not read the account list: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function showOverviewError(message) {
  setStatus(message, 'red', 'Reopen the popup to try again.');
  setBusy(true);
  document.body.dataset.working = 'false';
  el.logoutAllLabel.textContent = 'Unavailable';
  el.logoutAll.setAttribute('aria-busy', 'false');
  el.homeScope.textContent = 'Account list unavailable.';
  el.navAccountCount.textContent = '—';
  el.enabledLabel.textContent = 'Automation unknown';
  el.toggleEnabled.disabled = true;
}

function render() {
  if (!overview) return;
  if (overview.error) {
    showOverviewError(overview.error);
    return;
  }
  const { settings, sites, currentDomain, lastReport, crashTrail } = overview;

  renderCrashReport(overview.runInProgress ? null : crashTrail);
  if (!displayedReport || (lastReport && lastReport.startedAt >= displayedReport.startedAt)) displayedReport = lastReport;
  renderRunEvidence(displayedReport);
  renderRevokeGuidance(displayedReport);
  el.runMessage.hidden = !displayedReport;
  el.runMessage.textContent = displayedReport ? describe(displayedReport) : '';
  el.activityEmpty.hidden = !!displayedReport || !!crashTrail;

  const automation = automationState(settings);
  el.enabledLabel.textContent = automation.label;
  el.toggleEnabled.dataset.state = automation.state;
  el.toggleEnabled.title = automation.hint;
  el.toggleEnabled.disabled = false;
  if (chrome.extension?.inIncognitoContext) {
    setStatus('This list concerns the normal Chrome profile. Use a normal window for account cleanup; Incognito sessions are not covered.', 'amber');
  }

  const groups = accountGroups(sites, overview.relevance);
  const confirmedSites = groups.confirmed;
  const runnable = confirmedSites.filter((/** @type {any} */ s) => s.mode !== 'ignored');
  const critical = runnable.filter((/** @type {any} */ s) => s.tier === 'critical').length;
  const high = runnable.filter((/** @type {any} */ s) => s.tier === 'high').length;
  const kept = confirmedSites.length - runnable.length;
  el.navAccountCount.textContent = String(confirmedSites.length);
  el.homeScope.textContent = runnable.length
    ? `${runnable.length} confirmed account${runnable.length === 1 ? '' : 's'}${kept ? ` · ${kept} kept` : ' · this profile'}`
    : kept ? 'Your confirmed accounts are marked Keep.' : 'No confirmed accounts yet. Explore Accounts to start.';
  for (const [category, list] of Object.entries(groups)) document.getElementById(`count-${category}`).textContent = String(list.length);

  if (!runnable.length) {
    el.scopeHint.textContent = kept
      ? `No confirmed accounts will be touched; ${kept} ${kept === 1 ? 'is' : 'are'} marked Keep.`
      : 'No confirmed accounts to process.';
  } else {
    const scope = `Attempts site sign-out, then clears local session data for ${runnable.length} confirmed account${runnable.length === 1 ? '' : 's'}, highest risk first (${critical} critical, ${high} high risk).`;
    el.scopeHint.textContent = kept
      ? `${scope} ${kept} kept site${kept === 1 ? '' : 's'} will be skipped.`
      : scope;
  }

  // Current site card.
  const current = sites.find((/** @type {any} */ s) => s.domain === currentDomain);
  if (currentDomain) {
    el.current.hidden = false;
    el.currentDomain.textContent = currentDomain;
    const tier = current?.tier ?? 'low';
    el.currentTier.textContent = tier;
    el.currentTier.className = `badge ${tier}`;
    el.keepCurrent.checked = current?.mode === 'ignored';
    el.currentKept.hidden = current?.mode !== 'ignored';
  } else {
    el.current.hidden = true;
  }
  el.noCurrent.hidden = !!currentDomain;

  renderSiteList(groups);

  const result = compactResult(displayedReport, overview.runInProgress || actionInProgress);
  const attention = result.tone === 'red' || !!crashTrail;
  el.activityPreviewText.textContent = `${crashTrail && !overview.runInProgress ? 'Cleanup interrupted' : result.title} ↗`;
  el.activityPreview.dataset.attention = String(attention);
  el.activityDot.hidden = !attention && !overview.runInProgress && !actionInProgress;
  document.getElementById('tab-activity').setAttribute('aria-label', attention ? 'Activity, needs attention' : 'Activity');
  if (displayedReport) {
    const when = new Date(displayedReport.finishedAt ?? displayedReport.startedAt);
    el.lastRun.textContent = `${displayedReport.status === 'running' ? 'Latest checkpoint' : 'Last run'} · ${when.toLocaleTimeString()}`;
  } else {
    el.lastRun.textContent = 'No runs yet.';
  }
  setBusy(actionInProgress || overview.runInProgress === true);
  el.logoutAll.disabled ||= !settings.enabled || runnable.length === 0;
}

/**
 * The account and cookie-candidate lists.
 *
 * Cookie discovery finds every cookied domain, which on a real profile is hundreds. The
 * split between confirmed accounts, pre-existing candidates, and other cookied sites is
 * the difference between evidence and a wall of guesses. The bulk account action uses only
 * the confirmed set; scheduled cleanup may use the broader safety set.
 *
 * Search stays within the explicitly selected category. Visitor-cookie sites must not
 * become "confirmed" merely because someone searched for them.
 *
 * @param {{confirmed: any[], candidates: any[], other: any[]}} groups
 */
function renderSiteList(groups) {
  el.siteList.replaceChildren();
  const labels = { confirmed: 'Confirmed accounts', candidates: 'Pre-existing account candidates', other: 'Other cookied sites' };
  const notes = {
    confirmed: 'Positive login evidence was found for these sites. Keep excludes a site from bulk and automatic cleanup.',
    candidates: 'Not confirmed. Login opens the site so you can sign in or verify an existing login. Visitor cookies alone are not proof.',
    other: 'Cookies were found, not confirmed accounts. These are excluded from the account button; scheduled safety cleanup may still include them.'
  };
  el.listTitle.textContent = labels[accountCategory];
  el.accountHelp.textContent = notes[accountCategory];
  el.siteList.setAttribute('aria-label', labels[accountCategory]);
  el.filter.placeholder = `Search ${accountCategory === 'other' ? 'other sites' : accountCategory}…`;
  for (const button of el.listActions.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.category === accountCategory));
  const needle = filterText.trim().toLowerCase();
  const matches = groups[accountCategory].filter((site) => site.domain.includes(needle));
  el.siteCount.textContent = `${matches.length} ${accountCategory === 'confirmed' ? 'confirmed' : 'sites'}`;
  if (!matches.length) el.siteList.append(emptyRow(needle ? `No matches in ${accountCategory}.` : accountCategory === 'confirmed' ? 'No confirmed accounts yet. Open Candidates to check an existing login.' : 'Nothing in this category right now.'));
  for (const group of groupByTier(matches)) {
    el.siteList.append(tierHeading(group.tier, group.sites.length));
    for (const site of group.sites) el.siteList.append(buildSiteRow(site, accountCategory === 'candidates'));
  }
}

/** @param {string} text */
function emptyRow(text) {
  const row = document.createElement('li');
  row.className = 'empty';
  row.textContent = text;
  return row;
}

/**
 * @param {string} tier
 * @param {number} count
 */
function tierHeading(tier, count) {
  const row = document.createElement('li');
  row.className = `group-heading ${tier}`;
  row.setAttribute('role', 'presentation');
  row.textContent = `${tier} risk`;

  const n = document.createElement('span');
  n.className = 'count';
  n.textContent = String(count);
  row.append(n);
  return row;
}

/** @param {any} site @param {boolean} needsConfirmation */
function buildSiteRow(site, needsConfirmation) {
  const row = document.createElement('li');
  if (site.mode === 'ignored') row.classList.add('kept');

  const badge = document.createElement('span');
  badge.className = `badge ${site.tier}`;
  badge.textContent = `${site.tier} priority${site.mode === 'ignored' ? ' · kept' : ''}`;
  badge.title = site.tierReason;

  const name = document.createElement('span');
  name.className = 'site-name';
  name.textContent = site.domain;
  // The strongest reason leads. "not confirmed yet" is deliberately not phrased as a
  // claim: saying "you are signed in here" about a site the user has no account on is the
  // complaint this whole mechanism exists to answer.
  if (needsConfirmation) {
    name.title = 'Its cookies could belong to an account or an anonymous visitor. Login opens the site so the site itself can settle it.';
  } else if (site.reasons?.length) {
    const [reason] = site.reasons;
    name.title = reason.startsWith('cookies')
      ? `Shown because its ${reason}.`
      : `Shown because you are ${reason}.`;
  }

  const actions = document.createElement('span');
  actions.className = 'site-actions';

  const logout = document.createElement('button');
  logout.className = 'ghost small reveal';
  logout.textContent = 'Try sign-out';
  logout.type = 'button';
  logout.dataset.signoutDomain = site.domain;
  logout.setAttribute('aria-label', `Attempt sign-out of ${site.domain}`);
  logout.disabled = actionInProgress || overview?.runInProgress === true || overview?.settings?.enabled === false;
  logout.addEventListener('click', () => {
    if (maybePromptCompromise(site.domain, site.tier, logout)) return;
    act(`Attempting sign-out of ${site.domain}...`, { type: 'runSite', domain: site.domain });
  });

  // A site nothing could settle gets a real login route instead of another cookie guess.
  if (needsConfirmation) {
    actions.append(buildCandidateControl(site.domain));
  } else {
    actions.append(logout, buildKeepControl(site.domain, site.mode === 'ignored', 'Keep'));
  }

  const identity = document.createElement('div');
  identity.className = 'site-identity';
  identity.append(name, badge);
  row.append(identity, actions);
  return row;
}

/**
 * Open the site's own login flow, or optionally dismiss a candidate the user recognises as
 * irrelevant. Login never confirms by itself; the cookie transition, OAuth return, or the
 * site's signed-in page must provide the evidence.
 *
 * @param {string} domain
 */
function buildCandidateControl(domain) {
  const wrap = document.createElement('span');
  wrap.className = 'verdict';

  const login = document.createElement('button');
  login.className = 'ghost small';
  login.textContent = 'Login';
  login.title = `Open ${domain} and verify or complete its login`;
  login.addEventListener('click', async () => {
    login.disabled = true;
    login.textContent = 'Opening…';
    setStatus(`Opening ${domain} login...`, 'busy');
    revealStatus();
    try {
      const result = await send({ type: 'openLogin', domain });
      if (result?.error) throw new Error(result.error);
      setStatus('Login page opened', 'neutral', 'Finish signing in there, then reopen the popup. Opening a page does not confirm an account.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'red');
    } finally {
      login.disabled = false;
      login.textContent = 'Login';
    }
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'ghost small';
  dismiss.textContent = 'Not mine';
  dismiss.title = 'Remove this candidate. Scheduled safety wipes may still clear it.';
  dismiss.addEventListener('click', async () => {
    dismiss.disabled = true;
    dismiss.textContent = 'Removing…';
    try {
      const result = await send({ type: 'setSiteVerdict', domain, verdict: 'notMine' });
      if (result?.error) throw new Error(result.error);
      if (await load()) setStatus('Candidate dismissed', 'neutral', 'No site data was cleared. Scheduled safety cleanup rules still apply.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'red');
    } finally {
      dismiss.disabled = false;
      dismiss.textContent = 'Not mine';
    }
  });

  wrap.append(login, dismiss);

  return wrap;
}

function renderRunEvidence(report) {
  el.runEvidence.hidden = !report || (!report.sites?.length && !report.pending?.length && !report.skipped?.length);
  if (el.runEvidence.hidden) return;
  el.runEvidenceTitle.textContent = report.status === 'running'
    ? `${overview.runInProgress ? 'Cleanup in progress' : 'Cleanup interrupted'}: ${report.pending?.length ?? 0} site(s) unfinished`
    : `Last cleanup: ${summarize(report)}`;
  el.runEvidenceSites.replaceChildren();
  for (const site of report.sites ?? []) {
    const item = document.createElement('div');
    item.className = 'run-evidence-item';
    const title = document.createElement('strong');
    title.textContent = site.domain;
    const action = document.createElement('p');
    const attempted = site.serverAction === 'attempted' || ['logoutAttempted', 'loggedOut', 'revoked'].includes(site.outcome);
    action.textContent = attempted ? 'Website: sign-out attempted; remote revocation not verified.' : 'Website: no sign-out action was observed.';
    const local = document.createElement('p');
    local.textContent = localEvidenceText(site.localCleanup);
    if (site.outcome === 'failed') local.className = 'evidence-warning';
    item.append(title, action, local);
    el.runEvidenceSites.append(item);
  }
  for (const domain of report.pending ?? []) {
    const pending = document.createElement('p');
    pending.className = 'evidence-warning';
    pending.textContent = `${domain}: unfinished; no completed result was recorded.`;
    el.runEvidenceSites.append(pending);
  }
  for (const site of report.skipped ?? []) {
    const skipped = document.createElement('p');
    skipped.className = 'hint';
    skipped.textContent = `${site.domain ?? 'Cleanup'}: skipped — ${site.why}`;
    el.runEvidenceSites.append(skipped);
  }
}

/**
 * Show what the extension was doing when the browser died last time.
 *
 * The breadcrumb is written before each risky call and cleared on a clean finish, so its
 * presence means a run never returned. Naming the exact step is the whole point: it turns
 * "it closed Chrome" into something specific enough to fix.
 *
 * @param {any} crashTrail
 */
function renderCrashReport(crashTrail) {
  if (!crashTrail) {
    el.crashReport.hidden = true;
    return;
  }
  const when = new Date(crashTrail.at).toLocaleString();
  const site = crashTrail.domain ? ` on ${crashTrail.domain}` : '';
  el.crashDetail.textContent =
    ` It stopped at "${crashTrail.description}"${site}, at ${when}. Please send this line to whoever is fixing it.`;
  el.crashReport.hidden = false;
}

/**
 * The "leave this site alone" control, used both per row and for the current site.
 *
 * Checked means the site is excluded from every automatic trigger AND from
 * "Sign out of all confirmed accounts" - the whole point is that it survives the big button.
 * Explicit per-site actions still reach it, so the user is never locked out of clearing
 * a site they deliberately chose to keep.
 *
 * @param {string} domain
 * @param {boolean} kept
 * @param {string} labelText
 * @returns {HTMLLabelElement}
 */
function buildKeepControl(domain, kept, labelText) {
  const label = document.createElement('label');
  label.className = 'keep';
  label.title = `Never clear ${domain} automatically. It will be skipped by scheduled cleanup and by "Sign out of all confirmed accounts".`;

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = kept;
  box.addEventListener('change', async () => {
    box.disabled = true;
    const checked = box.checked;
    try {
      const result = await send({ type: 'setSiteOverride', domain, override: checked ? { mode: 'ignored' } : null });
      if (result?.error) throw new Error(result.error);
      if (await load()) setStatus(checked ? `${domain} is kept` : `${domain} is no longer kept`, 'neutral', checked ? 'Skipped by bulk and automatic cleanup. You can still act on it directly.' : 'Your configured cleanup rules apply again.');
    } catch (error) {
      box.checked = !checked;
      setStatus(`Could not save Keep: ${error instanceof Error ? error.message : String(error)}`, 'red');
    } finally {
      box.disabled = false;
    }
  });

  const text = document.createElement('span');
  text.textContent = labelText;

  label.append(box, text);
  return label;
}

/**
 * @param {string} busyText
 * @param {any} message
 */
async function act(busyText, message) {
  if (actionInProgress || overview?.runInProgress || overview?.settings?.enabled === false) return;
  actionInProgress = true;
  setStatus(busyText, 'busy');
  revealStatus();
  setBusy(true);
  try {
    const report = await send(message);
    if (report?.error) {
      setStatus(report.error, 'red');
    } else {
      displayedReport = report;
      showResult(report);
      renderRevokeGuidance(report);
      renderRunEvidence(report);
      // Keep the full report on Activity. Finishing is not a reason to flood Home.
      el.runEvidence.open = false;
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'red');
  } finally {
    try {
      overview = await send({ type: 'getOverview' });
    } catch (error) {
      setStatus(`Could not refresh the account list: ${error instanceof Error ? error.message : String(error)}. Reopen the popup to check the last cleanup.`, 'red');
    }
    actionInProgress = false;
    setBusy(false);
    render();
    if (overview?.runInProgress) {
      observedRunning = true;
      clearTimeout(runningPoll);
      runningPoll = setTimeout(load, 1200);
    }
    // The feedback card sits outside the panels: no scroll or focus jump on completion.
  }
}

function showResult(report) {
  const result = compactResult(report);
  setStatus(result.title, result.tone, result.detail, true);
}

/**
 * Interrupt routine sign-out with the safer compromised-account route.
 *
 * If malware may be active, the first instruction is to move to another trusted device.
 * The recovery checklist then separates session review, password changes, MFA, and recovery
 * methods instead of pretending any one action universally revokes every token.
 *
 * @param {string} domain
 * @param {string} tier
 * @param {HTMLElement} opener
 * @returns {boolean} true if a prompt was shown and the logout should wait
 */
function maybePromptCompromise(domain, tier, opener) {
  if (actionInProgress || overview?.runInProgress || overview?.settings?.enabled === false) return true;
  const setting = overview?.settings?.compromisePrompt ?? 'high';
  if (setting === 'never') return false;
  if (setting === 'high' && !atLeast(/** @type {any} */ (tier), 'high')) return false;

  const advice = compromiseAdviceFor(domain);
  if (!advice) return false;

  signoutPrompt.show(domain, advice, opener);

  return true;
}

/**
 * Spell out what actually happened, including the part people would rather not read.
 * @param {any} report
 * @returns {string}
 */
function describe(report) {
  const base = summarize(report);
  const cleared = (report?.sites ?? []).filter((/** @type {any} */ s) => s.outcome === 'cleared').length;
  if (cleared > 0) {
    return `${base} Sites marked "cleared locally" had their data deleted here, but the site may still list the session as active.`;
  }
  return base;
}

/**
 * Provider-owned controls that can finish the recovery work this run could not verify.
 *
 * Deleting cookies here does not ask the site to invalidate its server token. What the
 * user can review differs by site: some expose a session list, some revoke one at a time,
 * and some have no known session page. Password settings are offered when useful, without
 * claiming that a password change closes every session.
 *
 * @param {any} report
 */
function renderRevokeGuidance(report) {
  el.revokeGuidance.replaceChildren();
  const sites = (report?.sites ?? []).filter((/** @type {any} */ s) => s.revokeGuidance);
  if (sites.length === 0) return;

  const wrap = document.createElement('div');
  wrap.className = 'guidance';

  for (const site of sites) {
    const block = document.createElement('div');
    block.className = 'guidance-item';

    const head = document.createElement('strong');
    head.textContent = site.domain;
    block.append(head);

    const message = document.createElement('div');
    message.textContent = site.revokeGuidance.message;
    block.append(message);

    if (site.revokeGuidance.url) {
      const link = document.createElement('button');
      link.className = 'link';
      link.textContent = `Open ${site.revokeGuidance.label}`;
      link.addEventListener('click', () => chrome.tabs.create({ url: site.revokeGuidance.url }));
      block.append(link);
    }

    wrap.append(block);
  }

  el.revokeGuidance.append(wrap);
}

/** @param {boolean} busy */
function setBusy(busy) {
  document.body.dataset.working = String(busy);
  el.logoutAllLabel.textContent = busy ? 'Working…' : 'Sign out of all confirmed accounts';
  el.logoutAll.setAttribute('aria-busy', String(busy));
  for (const button of [el.logoutAll, el.logoutCurrent, el.clearCurrent, ...el.siteList.querySelectorAll('[data-signout-domain]')]) {
    button.disabled = busy || overview?.settings?.enabled === false;
  }
}

el.logoutAll.addEventListener('click', () => act('Attempting sign-out of all confirmed accounts...', { type: 'runNow' }));

el.logoutCurrent.addEventListener('click', () => {
  const domain = overview?.currentDomain;
  if (!domain) return;
  const tier = overview.sites.find((/** @type {any} */ s) => s.domain === domain)?.tier ?? 'low';
  if (maybePromptCompromise(domain, tier, el.logoutCurrent)) return;
  act(`Attempting sign-out of ${domain}...`, { type: 'runSite', domain });
});

el.clearCurrent.addEventListener('click', () => {
  if (!overview?.currentDomain) return;
  act(`Clearing ${overview.currentDomain}...`, { type: 'clearSite', domain: overview.currentDomain });
});

el.keepCurrent.addEventListener('change', async () => {
  if (!overview?.currentDomain) return;
  const checked = el.keepCurrent.checked;
  el.keepCurrent.disabled = true;
  try {
    const result = await send({ type: 'setSiteOverride', domain: overview.currentDomain, override: checked ? { mode: 'ignored' } : null });
    if (result?.error) throw new Error(result.error);
    if (await load()) setStatus(checked ? 'This site is kept' : 'Keep removed', 'neutral', checked ? 'Bulk and automatic cleanup will skip it. Direct site actions can still clear it.' : 'Your configured cleanup rules apply again.');
  } catch (error) {
    el.keepCurrent.checked = !checked;
    setStatus(`Could not save Keep: ${error instanceof Error ? error.message : String(error)}`, 'red');
  } finally {
    el.keepCurrent.disabled = false;
  }
});

el.toggleEnabled.addEventListener('click', async () => {
  if (!overview?.settings) return;
  const state = automationState(overview.settings).state;
  if (state === 'setup') return openAdvicePage(chrome.runtime.getURL('src/ui/welcome.html'), 'Setup opened. Automatic cleanup stays off until setup is complete.');
  if (state === 'off') return chrome.runtime.openOptionsPage();
  const next = !overview.settings.enabled;
  el.toggleEnabled.disabled = true;
  try {
    const result = await send({ type: 'updateSettings', patch: { enabled: next } });
    if (result?.error) throw new Error(result.error);
    if (await load()) setStatus(next ? 'Cleanup resumed' : 'Cleanup paused', 'neutral', next ? 'Manual actions and your configured triggers apply again.' : 'Manual and automatic cleanup are paused. A run already started may finish.');
  } catch (error) {
    setStatus(`Could not change automation: ${error instanceof Error ? error.message : String(error)}`, 'red');
  } finally {
    el.toggleEnabled.disabled = false;
  }
});

el.filter.addEventListener('input', () => {
  filterText = el.filter.value;
  render();
});

for (const button of el.listActions.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    accountCategory = button.dataset.category;
    filterText = '';
    el.filter.value = '';
    renderSiteList(accountGroups(overview?.sites, overview?.relevance));
    document.getElementById('panel-accounts').scrollTop = 0;
  });
}

function openActivity() {
  tabs.select('activity', true);
}
document.getElementById('current-options').addEventListener('toggle', (event) => {
  if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: 'nearest' });
});
el.activityPreview.addEventListener('click', openActivity);
el.statusView.addEventListener('click', () => {
  openActivity();
  el.runEvidence.open = true;
});
el.statusDismiss.addEventListener('click', () => {
  el.status.hidden = true;
  tabs.select(document.body.dataset.view, true);
});

el.crashDismiss.addEventListener('click', async () => {
  await send({ type: 'dismissCrashReport' });
  await load();
});

el.openRecovery.addEventListener('click', () => {
  window.open(chrome.runtime.getURL('src/ui/recovery.html'), '_blank');
});

el.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

window.addEventListener('pagehide', () => clearTimeout(runningPoll));
load();
