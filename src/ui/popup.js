/**
 * Popup. Renders the overview, dispatches actions, and reports outcomes honestly -
 * green only for separately verified revoke-everywhere behavior.
 */

import { outcomeColor, summarize } from '../engine/report.js';
import { compromiseAdviceFor } from '../core/session-pages.js';
import { atLeast } from '../core/risk.js';
import { groupByTier } from '../core/relevance.js';

/** @type {any} */
let overview = null;

const el = {
  status: /** @type {HTMLElement} */ (document.getElementById('status')),
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

/** Is the long tail of unrecognised sites expanded? Also survives re-renders. */
let showOther = false;

/** Are unanswered account candidates expanded? Kept separate from confirmed accounts. */
let showQuestions = false;

/**
 * @param {any} message
 * @returns {Promise<any>}
 */
function send(message) {
  return chrome.runtime.sendMessage(message);
}

/**
 * @param {string} text
 * @param {'green' | 'amber' | 'red' | 'busy'} tone
 */
function setStatus(text, tone) {
  el.status.hidden = false;
  el.status.className = `status ${tone}`;
  el.status.textContent = text;
}

async function load() {
  overview = await send({ type: 'getOverview' });
  render();
}

function render() {
  if (!overview) return;
  const { settings, sites, currentDomain, lastReport, crashTrail } = overview;

  renderCrashReport(crashTrail);

  el.enabledLabel.textContent = settings.enabled ? 'Active' : 'Paused';

  const confirmedDomains = new Set(overview.relevance?.confirmed ?? []);
  const confirmedSites = sites.filter((/** @type {any} */ s) => confirmedDomains.has(s.domain));
  const runnable = confirmedSites.filter((/** @type {any} */ s) => s.mode !== 'ignored');
  const critical = runnable.filter((/** @type {any} */ s) => s.tier === 'critical').length;
  const high = runnable.filter((/** @type {any} */ s) => s.tier === 'high').length;
  const kept = confirmedSites.length - runnable.length;
  // "225 sites" under a heading reading SIGNED IN was the claim that started this: most of
  // those had set a cookie while the user read a page. The shown count leads because it is
  // the honest one; the total stays visible so anonymous-cookie candidates are not hidden.
  const shown = overview.relevance?.confirmed?.length ?? overview.relevance?.used?.length ?? sites.length;
  el.logoutAll.disabled = !settings.enabled || runnable.length === 0;
  el.siteCount.textContent =
    shown === sites.length ? `${sites.length} confirmed` : `${shown} confirmed`;
  el.siteCount.title =
    shown === sites.length
      ? ''
      : `${shown} confirmed accounts. ${overview.relevance?.questionCount ?? 0} possible pre-existing accounts stay out until a site verifies its login. Other cookied sites are not included in the account button.`;
  el.filter.hidden = sites.length < 8;

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
  } else {
    el.current.hidden = true;
  }

  renderSiteList(sites, overview.relevance);

  if (lastReport?.sites?.length) {
    const when = new Date(lastReport.finishedAt);
    el.lastRun.textContent = `Last run ${when.toLocaleTimeString()} - ${summarize(lastReport)}`;
  } else {
    el.lastRun.textContent = 'No runs yet.';
  }
}

/**
 * The account and cookie-candidate lists.
 *
 * Cookie discovery finds every cookied domain, which on a real profile is hundreds. The
 * split between confirmed accounts, pre-existing candidates, and other cookied sites is
 * the difference between evidence and a wall of guesses. The bulk account action uses only
 * the confirmed set; scheduled cleanup may use the broader safety set.
 *
 * A filter escapes the split entirely — someone typing a domain is looking for that
 * domain, and finding nothing because it sat behind a disclosure would be maddening.
 *
 * @param {any[]} sites
 * @param {any} relevance
 */
function renderSiteList(sites, relevance) {
  el.siteList.replaceChildren();
  el.listActions.replaceChildren();

  if (sites.length === 0) {
    el.siteList.append(emptyRow('No sites with session-looking cookies found.'));
    return;
  }

  const needle = filterText.trim().toLowerCase();
  if (needle) {
    const matches = sites.filter((s) => s.domain.includes(needle));
    if (!matches.length) {
      el.siteList.append(emptyRow(`No sites match "${filterText}".`));
      return;
    }
    for (const site of matches) el.siteList.append(buildSiteRow(site));
    return;
  }

  const usedSet = new Set(relevance?.used ?? sites.map((s) => s.domain));
  const configuredSet = new Set(relevance?.configured ?? []);
  const questionSet = new Set(relevance?.questions ?? []);
  const used = sites.filter((s) => usedSet.has(s.domain));
  const configured = sites.filter((s) => !usedSet.has(s.domain) && configuredSet.has(s.domain));
  const questions = sites.filter((s) => !usedSet.has(s.domain) && !configuredSet.has(s.domain) && questionSet.has(s.domain));
  const other = sites.filter((s) => !usedSet.has(s.domain) && !configuredSet.has(s.domain) && !questionSet.has(s.domain));

  if (!used.length) {
    el.siteList.append(emptyRow('No confirmed accounts yet. Use Login below to verify one.'));
  }

  for (const group of groupByTier(used)) {
    el.siteList.append(tierHeading(group.tier, group.sites.length));
    for (const site of group.sites) el.siteList.append(buildSiteRow(site));
  }

  if (configured.length) {
    el.siteList.append(listHeading('Kept sites', configured.length));
    for (const site of configured) el.siteList.append(buildSiteRow(site));
  }

  // The two routes into everything else live BELOW the scrolling list, not inside it.
  // Placed there they sat under whatever happened to be the last confirmed account and
  // were simply never seen, so a profile with two hundred cookied domains looked like a
  // profile with four. A control that reveals the rest is worthless if it is itself hidden.
  if (questions.length) {
    el.listActions.append(questionDisclosureRow(questions.length));
    if (showQuestions) {
      el.siteList.append(reviewInstructionRow());
      for (const group of groupByTier(questions)) {
        el.siteList.append(tierHeading(group.tier, group.sites.length));
        for (const site of group.sites) el.siteList.append(buildSiteRow(site));
      }
    }
  }

  if (!other.length) return;
  el.listActions.append(otherDisclosureRow(other.length));
  if (!showOther) return;

  for (const group of groupByTier(other)) {
    el.siteList.append(tierHeading(group.tier, group.sites.length));
    for (const site of group.sites) el.siteList.append(buildSiteRow(site));
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

/**
 * The control that reveals the long tail.
 *
 * It states the count rather than saying "more", because the number is itself the honest
 * part: that a profile carries two hundred other cookied domains is information, and a
 * vague word would hide how much session-like state the browser is carrying.
 *
 * @param {number} count
 */
function otherDisclosureRow(count) {
  const row = document.createElement('li');
  row.className = 'disclosure';

  const button = document.createElement('button');
  button.className = 'link';
  button.type = 'button';
  button.textContent = showOther
    ? 'Hide other sites'
    : `Show ${count} other cookied site${count === 1 ? '' : 's'}`;
  button.title =
    'Sites you have cookies for but no confirmed login. Scheduled safety wipes may still clear them.';
  button.addEventListener('click', () => {
    showOther = !showOther;
    render();
  });

  row.append(button);
  return row;
}

/**
 * @param {string} label
 * @param {number} count
 */
function listHeading(label, count) {
  const row = document.createElement('li');
  row.className = 'group-heading';
  row.setAttribute('role', 'presentation');
  row.textContent = label;

  const n = document.createElement('span');
  n.className = 'count';
  n.textContent = String(count);
  row.append(n);
  return row;
}

/** @param {number} count */
function questionDisclosureRow(count) {
  const row = document.createElement('li');
  row.className = 'disclosure';

  const button = document.createElement('button');
  button.className = 'link';
  button.type = 'button';
  button.textContent = showQuestions
    ? 'Hide pre-existing account candidates'
    : `Log in to pre-existing accounts (${count} candidate${count === 1 ? '' : 's'})`;
  button.title =
    'These sites have session-looking cookies, but Chrome cannot tell whether the session belongs to an account. Login opens the site so it can verify the session.';
  button.addEventListener('click', () => {
    showQuestions = !showQuestions;
    render();
  });

  row.append(button);
  return row;
}

function reviewInstructionRow() {
  const row = document.createElement('li');
  row.className = 'review-note';
  row.textContent =
    'Login opens the site. If it already shows you signed in—or after you sign in—it moves to Confirmed accounts.';
  return row;
}

/** @param {any} site */
function buildSiteRow(site) {
  const row = document.createElement('li');
  if (site.mode === 'ignored') row.classList.add('kept');

  const badge = document.createElement('span');
  badge.className = `badge ${site.tier}`;
  badge.textContent = site.tier;
  badge.title = site.tierReason;

  const name = document.createElement('span');
  name.className = 'site-name';
  name.textContent = site.domain;
  // The strongest reason leads. "not confirmed yet" is deliberately not phrased as a
  // claim: saying "you are signed in here" about a site the user has no account on is the
  // complaint this whole mechanism exists to answer.
  if (site.needsConfirmation && site.mode !== 'ignored') {
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
  logout.textContent = 'Attempt sign-out';
  logout.addEventListener('click', () => {
    if (maybePromptCompromise(site.domain, site.tier)) return;
    act(`Attempting sign-out of ${site.domain}...`, { type: 'runSite', domain: site.domain });
  });

  // A site nothing could settle gets a real login route instead of another cookie guess.
  if (site.needsConfirmation && site.mode !== 'ignored') {
    actions.append(buildCandidateControl(site.domain));
  } else {
    actions.append(logout, buildKeepControl(site.domain, site.mode === 'ignored', 'Keep'));
  }

  row.append(badge, name, actions);
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
    setStatus(`Opening ${domain} login...`, 'busy');
    const result = await send({ type: 'openLogin', domain });
    if (result?.error) {
      login.disabled = false;
      setStatus(result.error, 'red');
    }
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'ghost small';
  dismiss.textContent = 'Not mine';
  dismiss.title = 'Remove this candidate. Scheduled safety wipes may still clear it.';
  dismiss.addEventListener('click', async () => {
    await send({ type: 'setSiteVerdict', domain, verdict: 'notMine' });
    overview = await send({ type: 'getOverview' });
    render();
  });

  wrap.append(login, dismiss);

  return wrap;
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
 * "Attempt sign-out of confirmed accounts" - the whole point is that it survives the big button.
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
  label.title = `Never clear ${domain} automatically. It will be skipped by scheduled cleanup and by "Attempt sign-out of confirmed accounts".`;

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = kept;
  box.addEventListener('change', async () => {
    await send({
      type: 'setSiteOverride',
      domain,
      override: box.checked ? { mode: 'ignored' } : null
    });
    await load();
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
  setStatus(busyText, 'busy');
  setBusy(true);
  try {
    const report = await send(message);
    if (report?.error) {
      setStatus(report.error, 'red');
    } else {
      const worst = worstColor(report);
      setStatus(describe(report), worst);
      renderRevokeGuidance(report);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'red');
  } finally {
    setBusy(false);
    overview = await send({ type: 'getOverview' });
    render();
  }
}

/**
 * @param {any} report
 * @returns {'green' | 'amber' | 'red'}
 */
function worstColor(report) {
  const colors = (report?.sites ?? []).map((/** @type {any} */ s) => outcomeColor(s.outcome));
  if (colors.includes('red')) return 'red';
  if (colors.includes('amber')) return 'amber';
  return colors.length ? 'green' : 'amber';
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
 * @returns {boolean} true if a prompt was shown and the logout should wait
 */
function maybePromptCompromise(domain, tier) {
  const setting = overview?.settings?.compromisePrompt ?? 'high';
  if (setting === 'never') return false;
  if (setting === 'high' && !atLeast(/** @type {any} */ (tier), 'high')) return false;

  const advice = compromiseAdviceFor(domain);
  if (!advice) return false;

  setStatus('', 'amber');
  el.status.replaceChildren();

  const title = document.createElement('strong');
  title.textContent = advice.title;
  title.style.display = 'block';
  title.style.marginBottom = '4px';

  const explanation = document.createElement('div');
  explanation.textContent = advice.explanation;
  explanation.style.marginBottom = '6px';

  const adviceText = document.createElement('div');
  adviceText.textContent = advice.advice;
  adviceText.style.marginBottom = '8px';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '6px';
  actions.style.flexWrap = 'wrap';

  const recovery = document.createElement('button');
  recovery.className = 'primary small';
  recovery.textContent = 'Open recovery checklist';
  recovery.title = 'Starts with clean-device guidance and does not log you out automatically';
  recovery.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/recovery.html') });
    setStatus(
      'Opened the recovery checklist. If malware may be active on this computer, continue from another device you trust.',
      'amber'
    );
  });

  /** @type {HTMLButtonElement | null} */
  let sessions = null;
  if (advice.sessionsUrl) {
    sessions = document.createElement('button');
    sessions.className = 'ghost small';
    sessions.textContent = 'Review active sessions';
    sessions.title = `Open ${advice.sessionsLabel ?? 'session settings'} for ${advice.domain}; use only on a trusted device`;
    sessions.addEventListener('click', () => chrome.tabs.create({ url: advice.sessionsUrl }));
  }

  const justLogout = document.createElement('button');
  justLogout.className = 'ghost small';
  justLogout.textContent = 'Attempt sign-out anyway';
  justLogout.addEventListener('click', () =>
    act(`Attempting sign-out of ${domain}...`, { type: 'runSite', domain })
  );

  actions.append(recovery);
  if (sessions) actions.append(sessions);
  actions.append(justLogout);
  el.status.append(title, explanation, adviceText, actions);

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
  const sites = (report?.sites ?? []).filter((/** @type {any} */ s) => s.revokeGuidance).slice(0, 6);
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

  el.status.append(wrap);
}

/** @param {boolean} busy */
function setBusy(busy) {
  for (const button of [el.logoutAll, el.logoutCurrent, el.clearCurrent]) {
    button.disabled = busy;
  }
}

el.logoutAll.addEventListener('click', () => act('Attempting site sign-out and clearing local sessions...', { type: 'runNow' }));

el.logoutCurrent.addEventListener('click', () => {
  const domain = overview?.currentDomain;
  if (!domain) return;
  const tier = overview.sites.find((/** @type {any} */ s) => s.domain === domain)?.tier ?? 'low';
  if (maybePromptCompromise(domain, tier)) return;
  act(`Attempting sign-out of ${domain}...`, { type: 'runSite', domain });
});

el.clearCurrent.addEventListener('click', () => {
  if (!overview?.currentDomain) return;
  act(`Clearing ${overview.currentDomain}...`, { type: 'clearSite', domain: overview.currentDomain });
});

el.keepCurrent.addEventListener('change', async () => {
  if (!overview?.currentDomain) return;
  await send({
    type: 'setSiteOverride',
    domain: overview.currentDomain,
    override: el.keepCurrent.checked ? { mode: 'ignored' } : null
  });
  await load();
});

el.toggleEnabled.addEventListener('click', async () => {
  const next = !overview.settings.enabled;
  await send({ type: 'updateSettings', patch: { enabled: next } });
  await load();
});

el.filter.addEventListener('input', () => {
  filterText = el.filter.value;
  render();
});

el.crashDismiss.addEventListener('click', async () => {
  await send({ type: 'dismissCrashReport' });
  el.crashReport.hidden = true;
});

el.openRecovery.addEventListener('click', () => {
  window.open(chrome.runtime.getURL('src/ui/recovery.html'), '_blank');
});

el.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
