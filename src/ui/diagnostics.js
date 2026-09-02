/**
 * Self-test for the browser-facing layer.
 *
 * Everything in core/ is covered by node tests, and the injected page logic by browser
 * tests. Neither can touch `chrome.cookies`, `chrome.browsingData`, or window creation —
 * those only exist inside an installed extension. This page closes that gap by running
 * the real functions from platform/ and engine/ and reporting what happened.
 *
 * Safety rules for every check below:
 *   - Nothing the user owns is deleted. Destructive checks target a domain under the
 *     reserved `.invalid` TLD, which by definition cannot resolve or hold real data.
 *   - Cookies are counted, never displayed. A diagnostics report the user might paste
 *     somewhere must not carry session material.
 *   - Any check that cannot run reports "skipped" with a reason, never a false pass.
 */

import { closeTab, findUsableWindow, sleep } from '../platform/tabs.js';
import { discoverSessions, likelyLoggedIn, wipeSite } from '../platform/sessions.js';
import { getActiveRecipes } from '../platform/recipe-store.js';
import { DEPTH_DATA_TYPES } from '../core/policy.js';
import { pageStep } from '../engine/step-runner.js';
import { registrableDomain } from '../core/domain.js';
import { formatLog } from '../platform/eventlog.js';
import { METHOD_LABELS, describeCoverage } from '../core/coverage.js';

/** Newline, named so the escape survives every layer of tooling between here and disk. */
const BREAK = String.fromCharCode(10);

/** Reserved TLD: guaranteed never to resolve, so clearing its data is a true no-op. */
const TEST_DOMAIN = 'session-sentinel-selftest.invalid';

/** @type {Array<{ name: string, status: 'pass'|'fail'|'skip', detail: string }>} */
const results = [];

const el = {
  run: /** @type {HTMLButtonElement} */ (document.getElementById('run')),
  copy: /** @type {HTMLButtonElement} */ (document.getElementById('copy')),
  body: /** @type {HTMLElement} */ (document.getElementById('results')),
  summary: /** @type {HTMLElement} */ (document.getElementById('summary')),
  env: /** @type {HTMLElement} */ (document.getElementById('env'))
};

/**
 * @param {string} name
 * @param {() => Promise<{ status?: 'pass'|'fail'|'skip', detail: string }>} fn
 */
async function check(name, fn) {
  let entry;
  try {
    const outcome = await fn();
    entry = { name, status: outcome.status ?? 'pass', detail: outcome.detail };
  } catch (error) {
    entry = { name, status: /** @type {const} */ ('fail'), detail: error instanceof Error ? error.message : String(error) };
  }
  results.push(entry);
  render();
  return entry;
}

function render() {
  el.body.replaceChildren();
  for (const entry of results) {
    const row = document.createElement('tr');

    const icon = document.createElement('td');
    icon.textContent = entry.status === 'pass' ? '✓' : entry.status === 'fail' ? '✕' : '–';
    icon.style.color =
      entry.status === 'pass' ? 'var(--green)' : entry.status === 'fail' ? 'var(--red)' : 'var(--text-muted)';
    icon.style.fontWeight = '700';

    const name = document.createElement('td');
    name.textContent = entry.name;

    const detail = document.createElement('td');
    detail.textContent = entry.detail;
    if (entry.status !== 'pass') detail.style.color = 'var(--text-muted)';

    row.append(icon, name, detail);
    el.body.append(row);
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const passed = results.filter((r) => r.status === 'pass').length;
  el.summary.textContent = `${passed} passed, ${failed} failed, ${skipped} skipped`;
  el.summary.style.color = failed ? 'var(--red)' : 'var(--green)';
}

async function run() {
  results.length = 0;
  el.run.disabled = true;
  el.copy.disabled = true;
  el.summary.textContent = 'Running...';

  const manifest = chrome.runtime.getManifest();
  const chromeVersion = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'unknown';
  el.env.textContent = `Session Sentinel ${manifest.version} · Chrome ${chromeVersion} · ${navigator.platform}`;

  // --- permissions ---------------------------------------------------------
  await check('Permissions granted', async () => {
    const granted = await chrome.permissions.getAll();
    const need = manifest.permissions ?? [];
    const missing = need.filter((p) => !granted.permissions?.includes(p));
    const allUrls = granted.origins?.some((o) => o === '<all_urls>' || o === '*://*/*');
    if (missing.length) return { status: 'fail', detail: `missing: ${missing.join(', ')}` };
    if (!allUrls) return { status: 'fail', detail: 'site access is not granted for all sites' };
    return { detail: `${need.length} API permissions + access to all sites` };
  });

  // --- storage -------------------------------------------------------------
  await check('Local storage read/write', async () => {
    const probe = { t: Date.now() };
    await chrome.storage.local.set({ __selftest: probe });
    const back = await chrome.storage.local.get('__selftest');
    await chrome.storage.local.remove('__selftest');
    if (back.__selftest?.t !== probe.t) return { status: 'fail', detail: 'value did not round-trip' };
    return { detail: 'settings can be saved and read back' };
  });

  await check('Session storage (used for the run lock)', async () => {
    await chrome.storage.session.set({ __selftest: 1 });
    const back = await chrome.storage.session.get('__selftest');
    await chrome.storage.session.remove('__selftest');
    return back.__selftest === 1
      ? { detail: 'available' }
      : { status: 'fail', detail: 'value did not round-trip' };
  });

  // --- triggers ------------------------------------------------------------
  await check('Idle detection (inactivity and screen lock)', async () => {
    const state = await chrome.idle.queryState(60);
    return { detail: `reported "${state}" — the lock and inactivity triggers read this` };
  });

  await check('Alarms (keep-alive and the weekly recipe check)', async () => {
    await chrome.alarms.create('__selftest', { periodInMinutes: 1 });
    const alarm = await chrome.alarms.get('__selftest');
    await chrome.alarms.clear('__selftest');
    return alarm ? { detail: 'can be scheduled' } : { status: 'fail', detail: 'alarm was not created' };
  });

  // --- cookie discovery ----------------------------------------------------
  await check('Cookie enumeration', async () => {
    const sessions = await discoverSessions();
    const signedIn = likelyLoggedIn(sessions);
    if (sessions.length === 0) {
      return { status: 'skip', detail: 'no cookies in this profile yet — sign into a site and re-run' };
    }
    // Counts only. A report the user might paste must never carry cookie contents.
    return { detail: `${sessions.length} sites with cookies, ${signedIn.length} look signed in` };
  });

  await check('Cookie stores (covers incognito when allowed)', async () => {
    const stores = await chrome.cookies.getAllCookieStores();
    return { detail: `${stores.length} store${stores.length === 1 ? '' : 's'} visible` };
  });

  // --- the destructive path, against a domain that cannot exist ------------
  await check('Per-type data clearing (the deep-wipe path)', async () => {
    const types = DEPTH_DATA_TYPES.deep;
    /** @type {string[]} */
    const ok = [];
    /** @type {string[]} */
    const bad = [];

    for (const type of types) {
      try {
        await chrome.browsingData.remove(
          { origins: [`https://${TEST_DOMAIN}`], originTypes: { unprotectedWeb: true } },
          { [type]: true }
        );
        ok.push(type);
      } catch {
        bad.push(type);
      }
    }

    if (bad.length === 0) return { detail: `all ${types.length} types accept origin scoping` };
    // This is exactly the silent-degradation case: a deep wipe would quietly clear less
    // than it claims. The engine reports it per site, but better to know up front.
    return {
      status: 'fail',
      detail: `${bad.join(', ')} rejected origin scoping — deep wipes will report these as not cleared`
    };
  });

  await check('Full wipe routine on a throwaway domain', async () => {
    const result = await wipeSite(TEST_DOMAIN, DEPTH_DATA_TYPES.deep);
    if (!result.ok) return { status: 'fail', detail: result.error ?? 'wipe reported failure' };
    return { detail: `cleared ${result.cleared.length} data types, ${result.failed.length} unavailable` };
  });

  // --- the hidden work window ---------------------------------------------
  const windowCheck = await check('Background work tab host', async () => {
    const before = (await chrome.windows.getAll({})).length;
    const id = await findUsableWindow();
    const after = (await chrome.windows.getAll({})).length;

    if (id === null) return { status: 'fail', detail: 'no ordinary window found to work in' };
    if (after !== before) return { status: 'fail', detail: 'window count changed — it must not' };
    return { detail: `will borrow window ${id}; no window is ever created or closed` };
  });

  // --- script injection, the mechanism behind every server-side logout -----
  await check('Script injection into a page', async () => {
    if (windowCheck.status === 'fail') {
      return { status: 'skip', detail: 'needs the background window, which failed above' };
    }
    let tabId = null;
    try {
      const windowId = await findUsableWindow();
      if (windowId === null) return { status: 'skip', detail: 'no window available' };
      const tab = await chrome.tabs.create({ windowId, url: 'https://example.com', active: false });
      tabId = tab.id;

      for (let i = 0; i < 40; i++) {
        const current = await chrome.tabs.get(tabId);
        if (current.status === 'complete') break;
        await sleep(250);
      }

      const [outcome] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageStep,
        args: [{ op: 'waitFor', selector: 'body', timeoutMs: 5000 }]
      });

      return outcome?.result?.ok
        ? { detail: 'ran in a real page — server-side logout works this way' }
        : { status: 'fail', detail: `injection returned: ${outcome?.result?.detail ?? 'no result'}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return /net::|Failed to fetch|ERR_/.test(message)
        ? { status: 'skip', detail: `needs internet access (${message})` }
        : { status: 'fail', detail: message };
    } finally {
      if (tabId !== null) await closeTab(tabId);
    }
  });

  // --- recipes and notifications ------------------------------------------
  await check('Logout recipes loaded', async () => {
    const recipes = await getActiveRecipes();
    const global = recipes.filter((r) => r.capability === 'global').length;
    return { detail: `${recipes.length} recipes (${global} claim revoke-everywhere)` };
  });

  await check('Notifications', async () => {
    const id = await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Session Sentinel',
      message: 'Diagnostics: notifications work.'
    });
    await sleep(1200);
    await chrome.notifications.clear(id);
    return { detail: 'a test notification was shown and dismissed' };
  });

  // --- current tab detection ----------------------------------------------
  await check('Current site detection', async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return { status: 'skip', detail: 'no active tab URL available' };
    const host = new URL(tab.url).hostname;
    return { detail: host ? `reads the active tab as ${registrableDomain(host)}` : 'active tab has no host' };
  });

  el.run.disabled = false;
  el.copy.disabled = false;
}

/**
 * The activity log. Its value is in what it shows AFTER a crash: whether the run reached
 * `run:complete` before the browser restarted, which separates "died mid-step" from
 * "finished, then the browser went away anyway".
 */
async function loadLog() {
  const entries = await chrome.runtime.sendMessage({ type: 'getEventLog' });
  const node = document.getElementById('log');
  if (!node) return;
  node.textContent = Array.isArray(entries) && entries.length
    ? formatLog(entries)
    : 'No activity recorded yet.';
}

document.getElementById('log-refresh')?.addEventListener('click', loadLog);

document.getElementById('log-copy')?.addEventListener('click', async () => {
  const node = document.getElementById('log');
  await navigator.clipboard.writeText(node?.textContent ?? '');
  const button = /** @type {HTMLButtonElement} */ (document.getElementById('log-copy'));
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = 'Copy log'; }, 1500);
});

document.getElementById('log-clear')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearEventLog' });
  await loadLog();
});

/**
 * Coverage: the number that decides where recipes are worth writing.
 *
 * Only attempted sites count towards the rate. A site below the tier threshold was never
 * tried, and counting it as a miss would blame the fallback for a decision the planner
 * made — which would make the number worse than useless.
 */
async function loadCoverage() {
  const { summary } = await chrome.runtime.sendMessage({ type: 'getCoverage' });
  const headline = document.getElementById('coverage-headline');
  const methods = document.getElementById('coverage-methods');
  const gaps = document.getElementById('coverage-gaps');
  if (!headline || !methods || !gaps) return;

  const described = describeCoverage(summary);
  headline.textContent = described ?? 'Nothing measured yet — log out of a few sites and come back.';
  headline.style.color =
    summary.hitRate === null ? 'var(--text-muted)' : summary.hitRate >= 60 ? 'var(--green)' : 'var(--amber)';

  methods.replaceChildren();
  for (const [method, count] of Object.entries(summary.byMethod).sort((a, b) => b[1] - a[1])) {
    const line = document.createElement('div');
    line.textContent = `${count} × ${METHOD_LABELS[method] ?? method}`;
    methods.append(line);
  }

  gaps.replaceChildren();
  if (summary.needsRecipe.length) {
    const title = document.createElement('strong');
    title.textContent = `${summary.needsRecipe.length} site(s) where nothing worked — these are the ones worth a recipe:`;
    title.style.display = 'block';
    title.style.marginBottom = '4px';
    gaps.append(title);

    const list = document.createElement('div');
    list.className = 'log';
    list.style.maxHeight = '160px';
    list.textContent = summary.needsRecipe
      .map((e) => `${e.domain}  (${e.runs} run${e.runs === 1 ? '' : 's'}, last ${new Date(e.at).toLocaleDateString()})`)
      .join(BREAK);
    gaps.append(list);
  }
}

document.getElementById('coverage-refresh')?.addEventListener('click', loadCoverage);

document.getElementById('coverage-copy')?.addEventListener('click', async () => {
  const { summary } = await chrome.runtime.sendMessage({ type: 'getCoverage' });
  const text = [
    describeCoverage(summary) ?? 'nothing measured yet',
    '',
    ...Object.entries(summary.byMethod).map(([m, n]) => `${n} x ${METHOD_LABELS[m] ?? m}`),
    '',
    'nothing worked on:',
    ...summary.needsRecipe.map((e) => `  ${e.domain}`)
  ].join(BREAK);
  await navigator.clipboard.writeText(text);
  const button = /** @type {HTMLButtonElement} */ (document.getElementById('coverage-copy'));
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = 'Copy list'; }, 1500);
});

document.getElementById('coverage-clear')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearCoverage' });
  // The record of which sites the user has signed into is the same kind of thing as the
  // coverage tally - an observation about them, not about the extension - so one control
  // forgets both. Leaving it behind a button labelled "clear" would be the wrong surprise.
  await chrome.runtime.sendMessage({ type: 'clearObservedLogins' });
  await loadCoverage();
});

el.run.addEventListener('click', run);
loadLog();
loadCoverage();

el.copy.addEventListener('click', async () => {
  const lines = [
    `Session Sentinel diagnostics`,
    el.env.textContent,
    el.summary.textContent,
    '',
    ...results.map((r) => `[${r.status.toUpperCase()}] ${r.name}: ${r.detail}`)
  ];
  await navigator.clipboard.writeText(lines.join('\n'));
  el.copy.textContent = 'Copied';
  setTimeout(() => { el.copy.textContent = 'Copy report'; }, 1500);
});
