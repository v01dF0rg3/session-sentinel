/**
 * Background tab plumbing.
 *
 * Logout has to happen in a real tab on the site's own origin. A fetch() from the
 * service worker carries origin chrome-extension://..., which is a different site, so
 * SameSite=Lax/Strict cookies are not attached and the request arrives unauthenticated.
 * A tab does not have that problem, and a click inside it picks up the live CSRF token
 * for free.
 *
 * THIS MODULE NEVER CREATES OR REMOVES A WINDOW.
 *
 * It used to open a hidden minimized window to work in, and that repeatedly quit the
 * user's browser: the window count is not something an extension can reason about
 * reliably, and Chrome exits the moment it hits zero. Every guard added around
 * `windows.remove()` was a patch on a risk that did not need to exist.
 *
 * Work now happens in a background tab inside a window the user already has open. If
 * there is no such window, the site sign-out attempt is skipped while local cleanup still
 * runs — honest, and incapable of ending the browser session.
 */

/**
 * A window that already exists and can host a background tab.
 *
 * Prefers the focused window so the work tab appears where the user is looking rather
 * than surprising them in some other window.
 *
 * @returns {Promise<number | null>} null when the browser has no ordinary window open.
 */
export async function findUsableWindow() {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (windows.length === 0) return null;
    const focused = windows.find((w) => w.focused && w.id !== undefined);
    return focused?.id ?? windows.find((w) => w.id !== undefined)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Open a tab in the work window and wait for it to finish loading.
 * @param {number} windowId
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<number>} tabId
 */
export async function openTab(windowId, url, timeoutMs) {
  const tab = await chrome.tabs.create({ windowId, url, active: false });
  if (!tab.id) throw new Error('tab creation failed');
  await waitForLoad(tab.id, timeoutMs);
  return tab.id;
}

/**
 * @param {number} tabId
 * @param {string} url
 * @param {number} timeoutMs
 */
export async function navigateTab(tabId, url, timeoutMs) {
  await chrome.tabs.update(tabId, { url });
  await waitForLoad(tabId, timeoutMs);
}

/**
 * Poll rather than listen: onUpdated listeners registered inside a run are lost if the
 * service worker is torn down, and polling degrades gracefully when a page never
 * reaches "complete" (long-polling SPAs do this constantly).
 * @param {number} tabId
 * @param {number} timeoutMs
 */
export async function waitForLoad(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        // Give client-side rendering a beat to paint before we look for selectors.
        await sleep(400);
        return;
      }
    } catch {
      throw new Error('tab closed while loading');
    }
    await sleep(200);
  }
}

/**
 * Close a tab — unless doing so would close the browser.
 *
 * The guard lives here rather than at each call site so it cannot be forgotten by
 * whatever calls this next. Closing the last tab closes its window; closing the last
 * window quits Chrome. No path through this extension is allowed to reach that, so when
 * a tab is the last one standing it is blanked instead of removed.
 *
 * @param {number} tabId
 */
export async function closeTab(tabId) {
  try {
    const windows = await chrome.windows.getAll({});
    if (windows.length <= 1) {
      const tab = await chrome.tabs.get(tabId);
      const siblings = await chrome.tabs.query({ windowId: tab.windowId });
      if (siblings.length <= 1) {
        await chrome.tabs.update(tabId, { url: 'about:blank' });
        return;
      }
    }
    await chrome.tabs.remove(tabId);
  } catch {
    // Already gone, or the browser is shutting down anyway.
  }
}

/**
 * Tabs currently showing a site, by id.
 *
 * @param {string} domain Registrable domain.
 * @returns {Promise<number[]>}
 */
export async function findTabsForDomain(domain) {
  /** @type {number[]} */
  const found = [];
  try {
    for (const tab of await chrome.tabs.query({})) {
      if (!tab.id || !tab.url) continue;
      let host;
      try {
        host = new URL(tab.url).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (host === domain || host.endsWith(`.${domain}`)) found.push(tab.id);
    }
  } catch {
    // Reporting no tabs is always safe: the caller then does nothing to them.
  }
  return found;
}

/**
 * Reload tabs, gently.
 *
 * This is the only thing the extension does to a user's tab when reload is configured. Earlier
 * versions navigated tabs to about:blank before wiping, so that a single-page app could
 * not write its tokens back afterwards. The reasoning holds, but tab manipulation is now
 * the last remaining suspect in a browser that kept dying mid-logout - and abruptly
 * tearing down a page mid-playback is exactly the kind of thing that can take a browser
 * process with it.
 *
 * `reload` is the gentlest option available: it is what Chrome does constantly on its own
 * and is far better exercised than a forced navigation.
 *
 * @param {number[]} tabIds
 * @returns {Promise<number>} Number successfully reloaded.
 */
export async function reloadTabs(tabIds) {
  let reloaded = 0;
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.reload(tabId);
      reloaded += 1;
    } catch {
      // Tab is gone, or cannot be reloaded. Never fatal.
    }
  }
  return reloaded;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
