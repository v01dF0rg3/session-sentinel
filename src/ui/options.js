/**
 * Options page. Thin - it reads settings, writes patches, and re-renders.
 */

import { TIERS } from '../core/risk.js';

/** @type {any} */
let overview = null;

/** Filter state for the site table. Held outside `overview` so re-renders keep it. */
let siteFilter = '';
let onlyConfigured = false;

/**
 * @param {any} message
 * @returns {Promise<any>}
 */
function send(message) {
  return chrome.runtime.sendMessage(message);
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node;
}

/**
 * @param {HTMLSelectElement} select
 * @param {string} selected
 */
function fillTiers(select, selected) {
  select.replaceChildren();
  for (const tier of TIERS) {
    const option = document.createElement('option');
    option.value = tier;
    option.textContent = `${tier} and above`;
    option.selected = tier === selected;
    select.append(option);
  }
}

/**
 * @param {Partial<import('../core/policy.js').Settings>} patch
 */
async function save(patch) {
  overview.settings = await send({ type: 'updateSettings', patch });
  byId('saved-note').textContent = `Saved ${new Date().toLocaleTimeString()}.`;
}

async function load() {
  overview = await send({ type: 'getOverview' });
  render();
}

function render() {
  const s = overview.settings;

  /** @type {HTMLInputElement} */ (byId('close-enabled')).checked = s.onBrowserClose.enabled;
  fillTiers(/** @type {HTMLSelectElement} */ (byId('close-tier')), s.onBrowserClose.minTier);

  /** @type {HTMLInputElement} */ (byId('idle-enabled')).checked = s.onIdle.enabled;
  /** @type {HTMLInputElement} */ (byId('idle-minutes')).value = String(s.onIdle.minutes);
  fillTiers(/** @type {HTMLSelectElement} */ (byId('idle-tier')), s.onIdle.minTier);

  /** @type {HTMLInputElement} */ (byId('lock-enabled')).checked = s.onLock.enabled;
  fillTiers(/** @type {HTMLSelectElement} */ (byId('lock-tier')), s.onLock.minTier);

  /** @type {HTMLInputElement} */ (byId('server-enabled')).checked = s.serverLogout.enabled;
  fillTiers(/** @type {HTMLSelectElement} */ (byId('server-tier')), s.serverLogout.minTier);

  /** @type {HTMLInputElement} */ (byId('notifications')).checked = s.notifications;
  /** @type {HTMLSelectElement} */ (byId('tab-handling')).value = s.tabHandling;
  /** @type {HTMLSelectElement} */ (byId('compromise-prompt')).value = s.compromisePrompt;
  /** @type {HTMLInputElement} */ (byId('use-frequency')).checked = s.useVisitFrequency;
  renderFrequencyStatus();
  /** @type {HTMLInputElement} */ (byId('recipe-enabled')).checked = s.recipeUpdates.enabled;
  renderRecipeStatus();

  renderDepthRows(s);
  renderSiteRows();
}

/**
 * Say plainly where the recipes in force came from, and surface the last failure rather
 * than letting updates fail silently for months.
 */
function renderRecipeStatus() {
  const status = overview.recipeStatus;
  const updates = overview.settings.recipeUpdates;
  const node = byId('recipe-status');
  node.className = 'muted';

  if (!status) {
    node.textContent = '';
    return;
  }

  const source =
    status.source === 'bundle'
      ? `${status.total} recipes in use (bundle v${status.bundleVersion}).`
      : `${status.total} recipes in use, all built into the extension.`;

  if (updates.lastError) {
    node.className = 'muted';
    // A bare network failure reads as a bug. There is simply no bundle host published
    // yet, and saying that is more use than relaying the fetch error verbatim.
    const networkish = /failed to fetch|networkerror|name not resolved|err_/i.test(updates.lastError);
    node.textContent = networkish
      ? `${source} No recipe server is published yet, so there is nothing to download — the built-in recipes are in force and nothing is wrong.`
      : `${source} Last update failed: ${updates.lastError}. Built-in recipes are still in force.`;
    return;
  }
  if (!updates.enabled) {
    node.textContent = `${source} Automatic updates are off.`;
    return;
  }
  node.textContent = updates.lastCheck
    ? `${source} Last checked ${new Date(updates.lastCheck).toLocaleString()}.`
    : `${source} Not checked yet.`;
}

/** @param {import('../core/policy.js').Settings} s */
function renderDepthRows(s) {
  const body = byId('depth-rows');
  body.replaceChildren();

  for (const tier of TIERS) {
    const row = document.createElement('tr');

    const label = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${tier}`;
    badge.textContent = tier;
    label.append(badge);

    const control = document.createElement('td');
    const select = document.createElement('select');
    for (const depth of ['cookies', 'standard', 'deep']) {
      const option = document.createElement('option');
      option.value = depth;
      option.textContent = depth;
      option.selected = s.depthByTier[tier] === depth;
      select.append(option);
    }
    select.addEventListener('change', () =>
      save({ depthByTier: { ...overview.settings.depthByTier, [tier]: select.value } })
    );
    control.append(select);

    row.append(label, control);
    body.append(row);
  }
}

function renderSiteRows() {
  const body = byId('site-rows');
  body.replaceChildren();

  const needle = siteFilter.trim().toLowerCase();
  const visible = overview.sites.filter((/** @type {any} */ s) => {
    if (needle && !s.domain.includes(needle)) return false;
    if (onlyConfigured && s.mode === 'default') return false;
    return true;
  });

  const total = overview.sites.length;
  byId('site-search-count').textContent =
    visible.length === total ? `${total} sites` : `${visible.length} of ${total}`;

  if (!total) {
    body.append(emptyRow('No signed-in sites detected yet.'));
    return;
  }
  if (!visible.length) {
    body.append(emptyRow(onlyConfigured && !needle
      ? 'No sites have been given custom handling yet.'
      : `No sites match "${siteFilter}".`));
    return;
  }

  for (const site of visible) {
    const row = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = site.domain;

    const risk = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${site.tier}`;
    badge.textContent = site.tier;
    badge.title = site.tierReason;
    risk.append(badge);

    const handling = document.createElement('td');
    const select = document.createElement('select');
    for (const [value, label] of [
      ['default', 'default'],
      ['protected', 'always protect'],
      ['ignored', 'never clear']
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = site.mode === value;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      await send({
        type: 'setSiteOverride',
        domain: site.domain,
        override: select.value === 'default' ? null : { mode: select.value }
      });
      await load();
    });
    handling.append(select);

    const spacer = document.createElement('td');

    row.append(name, risk, handling, spacer);
    body.append(row);
  }
}

/**
 * @param {string} text
 * @returns {HTMLTableRowElement}
 */
function emptyRow(text) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 4;
  cell.className = 'muted';
  cell.textContent = text;
  row.append(cell);
  return row;
}

// --- wiring ----------------------------------------------------------------

byId('site-search').addEventListener('input', (e) => {
  siteFilter = /** @type {HTMLInputElement} */ (e.target).value;
  renderSiteRows();
});

byId('only-configured').addEventListener('change', (e) => {
  onlyConfigured = /** @type {HTMLInputElement} */ (e.target).checked;
  renderSiteRows();
});

byId('close-enabled').addEventListener('change', (e) =>
  save({ onBrowserClose: { ...overview.settings.onBrowserClose, enabled: /** @type {HTMLInputElement} */ (e.target).checked } })
);
byId('close-tier').addEventListener('change', (e) =>
  save({ onBrowserClose: { ...overview.settings.onBrowserClose, minTier: /** @type {HTMLSelectElement} */ (e.target).value } })
);

byId('idle-enabled').addEventListener('change', (e) =>
  save({ onIdle: { ...overview.settings.onIdle, enabled: /** @type {HTMLInputElement} */ (e.target).checked } })
);
byId('idle-tier').addEventListener('change', (e) =>
  save({ onIdle: { ...overview.settings.onIdle, minTier: /** @type {HTMLSelectElement} */ (e.target).value } })
);
byId('idle-minutes').addEventListener('change', (e) => {
  const minutes = Math.min(480, Math.max(1, Number(/** @type {HTMLInputElement} */ (e.target).value) || 30));
  save({ onIdle: { ...overview.settings.onIdle, minutes } });
});

byId('lock-enabled').addEventListener('change', (e) =>
  save({ onLock: { ...overview.settings.onLock, enabled: /** @type {HTMLInputElement} */ (e.target).checked } })
);
byId('lock-tier').addEventListener('change', (e) =>
  save({ onLock: { ...overview.settings.onLock, minTier: /** @type {HTMLSelectElement} */ (e.target).value } })
);

byId('server-enabled').addEventListener('change', (e) =>
  save({ serverLogout: { ...overview.settings.serverLogout, enabled: /** @type {HTMLInputElement} */ (e.target).checked } })
);
byId('server-tier').addEventListener('change', (e) =>
  save({ serverLogout: { ...overview.settings.serverLogout, minTier: /** @type {HTMLSelectElement} */ (e.target).value } })
);

byId('recipe-enabled').addEventListener('change', async (e) => {
  await save({
    recipeUpdates: { ...overview.settings.recipeUpdates, enabled: /** @type {HTMLInputElement} */ (e.target).checked }
  });
  await load();
});

byId('recipe-check').addEventListener('click', async () => {
  const button = /** @type {HTMLButtonElement} */ (byId('recipe-check'));
  button.disabled = true;
  byId('recipe-status').textContent = 'Checking...';
  try {
    await send({ type: 'refreshRecipes' });
  } finally {
    button.disabled = false;
    await load();
  }
});

byId('open-diagnostics').addEventListener('click', () => {
  // Plain link rather than a message: diagnostics must work even if the service worker
  // is wedged, since that is one of the things it exists to reveal.
  window.open(chrome.runtime.getURL('src/ui/diagnostics.html'), '_blank');
});

/**
 * Requesting an optional permission needs a user gesture, so it happens here on the click
 * rather than anywhere in the background. If the user declines the Chrome prompt, the
 * setting goes back to off rather than sitting on with no permission behind it.
 */
byId('use-frequency').addEventListener('change', async (e) => {
  const box = /** @type {HTMLInputElement} */ (e.target);
  if (box.checked) {
    const granted = await chrome.permissions.request({ permissions: ['topSites'] });
    if (!granted) {
      box.checked = false;
      byId('frequency-status').textContent = 'Permission declined — ordering is unchanged.';
      return;
    }
    await save({ useVisitFrequency: true });
  } else {
    await send({ type: 'dropFrequency' });
  }
  await load();
});

async function renderFrequencyStatus() {
  const node = byId('frequency-status');
  const { granted } = await send({ type: 'frequencyStatus' });
  node.className = 'muted';
  node.textContent = overview.settings.useVisitFrequency
    ? granted
      ? 'On. Used only to order equally-risky accounts.'
      : 'Permission is missing — switch this off and on again to restore it.'
    : '';
}

byId('compromise-prompt').addEventListener('change', (e) =>
  save({ compromisePrompt: /** @type {HTMLSelectElement} */ (e.target).value })
);

byId('tab-handling').addEventListener('change', (e) =>
  save({ tabHandling: /** @type {HTMLSelectElement} */ (e.target).value })
);

byId('notifications').addEventListener('change', (e) =>
  save({ notifications: /** @type {HTMLInputElement} */ (e.target).checked })
);

load();
