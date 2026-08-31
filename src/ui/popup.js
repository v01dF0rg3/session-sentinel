/**
 * Popup. Renders the overview, dispatches actions, and reports outcomes honestly -
 * green only when a site confirmed it revoked sessions everywhere.
 */

import { outcomeColor, summarize } from '../engine/report.js';
import { compromiseAdviceFor } from '../core/session-pages.js';
import { atLeast } from '../core/risk.js';

/** @type {any} */
let overview = null;

const el = {
  status: /** @type {HTMLElement} */ (document.getElementById('status')),
  siteList: /** @type {HTMLUListElement} */ (document.getElementById('site-list')),
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
  filter: /** @type {HTMLInputElement} */ (document.getElementById('site-filter')),
  crashReport: /** @type {HTMLElement} */ (document.getElementById('crash-report')),
  crashDetail: /** @type {HTMLElement} */ (document.getElementById('crash-detail')),
  crashDismiss: /** @type {HTMLButtonElement} */ (document.getElementById('crash-dismiss'))
};

/** Current text in the filter box. Kept out of `overview` so re-renders preserve it. */
let filterText = '';

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
  el.logoutAll.disabled = !settings.enabled;

  const critical = sites.filter((/** @type {any} */ s) => s.tier === 'critical').length;
  const high = sites.filter((/** @type {any} */ s) => s.tier === 'high').length;
  const kept = sites.filter((/** @type {any} */ s) => s.mode === 'ignored').length;
  el.siteCount.textContent = `${sites.length} site${sites.length === 1 ? '' : 's'}`;
  el.filter.hidden = sites.length < 8;

  if (!sites.length) {
    el.scopeHint.textContent = 'No signed-in sites detected.';
  } else {
    const scope = `Ends every session found here, hardest first (${critical} critical, ${high} high risk).`;
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

  // Site list, narrowed by the filter box.
  el.siteList.replaceChildren();

  const needle = filterText.trim().toLowerCase();
  const visible = needle ? sites.filter((/** @type {any} */ s) => s.domain.includes(needle)) : sites;

  if (sites.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No signed-in sites found yet. They appear here as you browse.';
    el.siteList.append(empty);
  } else if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = `No sites match "${filterText}".`;
    el.siteList.append(empty);
  }

  for (const site of visible) {
    const row = document.createElement('li');
    if (site.mode === 'ignored') row.classList.add('kept');

    const badge = document.createElement('span');
    badge.className = `badge ${site.tier}`;
    badge.textContent = site.tier;
    badge.title = site.tierReason;

    const name = document.createElement('span');
    name.className = 'site-name';
    name.textContent = site.domain;

    const actions = document.createElement('span');
    actions.className = 'site-actions';

    const logout = document.createElement('button');
    logout.className = 'ghost small reveal';
    logout.textContent = 'Log out';
    logout.addEventListener('click', () => {
      if (maybePromptCompromise(site.domain, site.tier)) return;
      act(`Signing out of ${site.domain}...`, { type: 'runSite', domain: site.domain });
    });

    actions.append(logout, buildKeepControl(site.domain, site.mode === 'ignored', 'Keep'));
    row.append(badge, name, actions);
    el.siteList.append(row);
  }

  if (lastReport?.sites?.length) {
    const when = new Date(lastReport.finishedAt);
    el.lastRun.textContent = `Last run ${when.toLocaleTimeString()} - ${summarize(lastReport)}`;
  } else {
    el.lastRun.textContent = 'No runs yet.';
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
 * "Log out of all sessions" - the whole point is that it survives the big red button.
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
  label.title = `Never clear ${domain} automatically. It will be skipped by scheduled logouts and by "Log out of all sessions".`;

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
 * Offer the password-change route before logging out, where it applies.
 *
 * The ordering is the substance of this. If someone else is using your account, logging
 * yourself out is the wrong first move: it gives up the one authenticated session you
 * control and leaves theirs running. Changing the password from the session you already
 * have kills every other session at once and keeps you signed in.
 *
 * Offering that *after* the logout would be useless, so the prompt interrupts.
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

  const compromised = document.createElement('button');
  compromised.className = 'primary small';
  compromised.textContent = 'I think I have been hacked';
  compromised.title = `Opens ${advice.domain} password settings. Does NOT log you out.`;
  compromised.addEventListener('click', () => {
    // Deliberately does not log out: the user keeps the session they need in order to
    // change the password.
    chrome.tabs.create({ url: advice.passwordUrl });
    setStatus(`Opened ${advice.domain} password settings. You have not been logged out — change the password from that page and every other session ends.`, 'amber');
  });

  const justLogout = document.createElement('button');
  justLogout.className = 'ghost small';
  justLogout.textContent = 'No, just log me out';
  justLogout.addEventListener('click', () =>
    act(`Signing out of ${domain}...`, { type: 'runSite', domain })
  );

  actions.append(compromised, justLogout);
  el.status.append(title, explanation, adviceText, actions);

  if (advice.sessionsUrl) {
    const link = document.createElement('button');
    link.className = 'link';
    link.style.marginTop = '6px';
    link.style.display = 'block';
    link.textContent = `Or review ${advice.sessionsLabel} yourself`;
    link.addEventListener('click', () => chrome.tabs.create({ url: advice.sessionsUrl }));
    el.status.append(link);
  }

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
 * What would actually end the sessions this run could not reach.
 *
 * Deleting cookies here does not end a session on the site's side - it abandons it, and
 * the site carries on listing it as active. What finishes the job differs by site: some
 * let you revoke from a list, some only one at a time, and some offer nothing at all, in
 * which case changing the password is the honest answer. Saying which is which is the
 * whole point.
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

el.logoutAll.addEventListener('click', () => act('Ending sessions...', { type: 'runNow' }));

el.logoutCurrent.addEventListener('click', () => {
  const domain = overview?.currentDomain;
  if (!domain) return;
  const tier = overview.sites.find((/** @type {any} */ s) => s.domain === domain)?.tier ?? 'low';
  if (maybePromptCompromise(domain, tier)) return;
  act(`Signing out of ${domain}...`, { type: 'runSite', domain });
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

el.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
