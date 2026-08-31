/**
 * First-run screen.
 *
 * Its job is consent, not decoration. Until `onboarded` is set, `buildPlan` refuses every
 * automatic trigger, so this page is the only thing standing between a fresh install and
 * an unexplained sign-out of someone's bank at the next browser close.
 *
 * It shows the sites that will actually be affected - read from the real cookie jar, not
 * described in the abstract - and lets the user exempt any of them before anything runs.
 */

import { atLeast } from '../core/risk.js';

/** @type {any} */
let overview = null;

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

async function load() {
  overview = await send({ type: 'getOverview' });
  render();
}

function render() {
  const list = byId('affected');
  const settings = overview.settings;

  // Only the sites the default triggers would actually touch. Listing everything with a
  // cookie would bury the ones that matter and overstate what the extension does.
  const floor = settings.onBrowserClose.minTier;
  const affected = overview.sites.filter((/** @type {any} */ s) => atLeast(s.tier, floor));

  byId('affected-empty').hidden = affected.length > 0;
  list.replaceChildren();

  for (const site of affected) {
    const row = document.createElement('li');
    if (site.mode === 'ignored') row.classList.add('kept');

    const badge = document.createElement('span');
    badge.className = `badge ${site.tier}`;
    badge.textContent = site.tier;
    badge.title = site.tierReason;

    const name = document.createElement('span');
    name.className = 'site-name';
    name.textContent = site.domain;

    // Checked means "clear this", so unticking is the exemption. Phrased positively
    // because the list is headed "sites this will affect".
    const label = document.createElement('label');
    label.className = 'keep';
    label.title = `Untick to stay signed in to ${site.domain}`;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = site.mode !== 'ignored';
    box.addEventListener('change', async () => {
      await send({
        type: 'setSiteOverride',
        domain: site.domain,
        override: box.checked ? null : { mode: 'ignored' }
      });
      await load();
    });

    const text = document.createElement('span');
    text.textContent = box.checked ? 'Clear' : 'Keep signed in';

    label.append(box, text);
    row.append(badge, name, label);
    list.append(row);
  }
}

/**
 * @param {boolean} automatic
 */
async function finish(automatic) {
  await send({
    type: 'updateSettings',
    patch: automatic
      ? { onboarded: true, enabled: true }
      : {
          onboarded: true,
          enabled: true,
          onBrowserClose: { ...overview.settings.onBrowserClose, enabled: false },
          onIdle: { ...overview.settings.onIdle, enabled: false },
          onLock: { ...overview.settings.onLock, enabled: false }
        }
  });

  byId('finish-note').textContent = automatic
    ? 'Automatic protection is on. You can change or pause it any time from the popup.'
    : 'Automatic triggers are off. Use the toolbar button to log out whenever you want, and turn them on later in settings.';
  /** @type {HTMLButtonElement} */ (byId('finish')).disabled = true;
  /** @type {HTMLButtonElement} */ (byId('manual-only')).disabled = true;
}

byId('finish').addEventListener('click', () => finish(true));
byId('manual-only').addEventListener('click', () => finish(false));

load();
