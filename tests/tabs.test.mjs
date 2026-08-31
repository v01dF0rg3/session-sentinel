/**
 * Tests for tab and window handling, against a fake `chrome` global.
 *
 * This file exists because of a bug that closed the user's browser. "Log out of all
 * sessions" closed every tab on every signed-in site; that closed the windows containing
 * them; a browser with no windows quits. The extension's own hidden work window closing
 * immediately afterwards made it certain.
 *
 * The lesson is not "be careful with tabs.remove" — it is that platform/ had no test
 * coverage at all because it touches chrome.*. A fake global costs very little and would
 * have caught this, so the invariant is now pinned:
 *
 *   THE EXTENSION MUST NEVER BE ABLE TO CLOSE THE USER'S BROWSER.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * @param {{ windows: any[], tabs: any[] }} state
 */
function fakeChrome(state) {
  const removedTabs = [];
  const removedWindows = [];
  const sessionStore = {};

  globalThis.chrome = {
    storage: {
      session: {
        get: async (key) => ({ [key]: sessionStore[key] }),
        set: async (obj) => Object.assign(sessionStore, obj),
        remove: async (key) => { delete sessionStore[key]; }
      }
    },
    tabs: {
      query: async (q = {}) =>
        q.windowId === undefined ? [...state.tabs] : state.tabs.filter((t) => t.windowId === q.windowId),
      get: async (id) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) throw new Error('no such tab');
        return tab;
      },
      update: async (id, props) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) throw new Error('no such tab');
        if (props.url) tab.url = props.url;
        return tab;
      },
      remove: async (id) => {
        removedTabs.push(id);
        const i = state.tabs.findIndex((t) => t.id === id);
        if (i >= 0) state.tabs.splice(i, 1);
      },
      create: async () => ({ id: 900, status: 'complete' })
    },
    windows: {
      getAll: async (q = {}) =>
        q.windowTypes ? state.windows.filter((w) => q.windowTypes.includes(w.type ?? 'normal')) : [...state.windows],
      get: async (id) => {
        const win = state.windows.find((w) => w.id === id);
        if (!win) throw new Error('no such window');
        return win;
      },
      create: async () => {
        const win = { id: 42, state: 'normal' };
        state.windows.push(win);
        return win;
      },
      update: async (id, props) => {
        const win = state.windows.find((w) => w.id === id);
        if (win && props.state) win.state = props.state;
        return win;
      },
      remove: async (id) => {
        removedWindows.push(id);
        const i = state.windows.findIndex((w) => w.id === id);
        if (i >= 0) state.windows.splice(i, 1);
      }
    }
  };

  return { removedTabs, removedWindows, sessionStore };
}

const load = () => import('../src/platform/tabs.js?' + Math.random().toString(36).slice(2));

test('finding the tabs for a site never touches them', async () => {
  const state = {
    windows: [{ id: 1, state: 'normal' }],
    tabs: [
      { id: 10, windowId: 1, url: 'https://github.com/settings' },
      { id: 11, windowId: 1, url: 'https://gist.github.com/abc' },
      { id: 12, windowId: 1, url: 'https://unrelated.example/page' }
    ]
  };
  const spy = fakeChrome(state);
  const { findTabsForDomain } = await load();

  const found = await findTabsForDomain('github.com');

  assert.deepEqual(spy.removedTabs, [], 'no tab may be closed');
  assert.deepEqual(found, [10, 11], 'both github tabs found, subdomain included');
  assert.deepEqual(
    state.tabs.map((t) => t.url),
    ['https://github.com/settings', 'https://gist.github.com/abc', 'https://unrelated.example/page'],
    'no tab was navigated - finding is read-only'
  );
});

test('logging out of every open site leaves the browser standing', async () => {
  // The exact shape of the original bug: every open tab belongs to a targeted site.
  const state = {
    windows: [{ id: 1, state: 'normal' }],
    tabs: [
      { id: 10, windowId: 1, url: 'https://github.com/' },
      { id: 11, windowId: 1, url: 'https://mail.google.com/' },
      { id: 12, windowId: 1, url: 'https://chase.com/' }
    ]
  };
  const spy = fakeChrome(state);
  const { findTabsForDomain } = await load();

  for (const domain of ['github.com', 'google.com', 'chase.com']) {
    await findTabsForDomain(domain);
  }

  assert.deepEqual(spy.removedTabs, []);
  assert.deepEqual(spy.removedWindows, []);
  assert.equal(state.tabs.length, 3, 'all tabs survive');
  assert.equal(state.windows.length, 1, 'the window survives, so the browser does too');
});

test('reloading tabs reloads and never closes or navigates', async () => {
  const state = {
    windows: [{ id: 1, state: 'normal' }],
    tabs: [{ id: 10, windowId: 1, url: 'https://github.com/settings/profile' }]
  };
  const spy = fakeChrome(state);
  const reloaded = [];
  chrome.tabs.reload = async (id) => { reloaded.push(id); };

  const { findTabsForDomain, reloadTabs } = await load();
  await reloadTabs(await findTabsForDomain('github.com'));

  assert.deepEqual(reloaded, [10]);
  assert.deepEqual(spy.removedTabs, []);
  assert.equal(state.tabs[0].url, 'https://github.com/settings/profile', 'URL is untouched');
});

test('a tab that vanishes mid-run does not break the reload', async () => {
  const state = {
    windows: [{ id: 1, state: 'normal' }],
    tabs: [{ id: 10, windowId: 1, url: 'https://github.com/' }]
  };
  fakeChrome(state);
  chrome.tabs.reload = async () => { throw new Error('no such tab'); };

  const { reloadTabs } = await load();
  await assert.doesNotReject(() => reloadTabs([10]));
});

test('closing the last tab of the last window blanks it instead', async () => {
  // The universal net: whatever calls closeTab next cannot quit the browser with it.
  const state = {
    windows: [{ id: 1, state: 'normal' }],
    tabs: [{ id: 10, windowId: 1, url: 'https://example.com/' }]
  };
  const spy = fakeChrome(state);
  const { closeTab } = await load();

  await closeTab(10);

  assert.deepEqual(spy.removedTabs, [], 'the last tab must survive');
  assert.equal(state.tabs[0].url, 'about:blank');
});

test('closing a tab is normal when siblings or other windows exist', async () => {
  const withSibling = {
    windows: [{ id: 1, state: 'normal' }],
    tabs: [
      { id: 10, windowId: 1, url: 'https://example.com/' },
      { id: 11, windowId: 1, url: 'https://other.example/' }
    ]
  };
  const spyA = fakeChrome(withSibling);
  const { closeTab: closeA } = await load();
  await closeA(10);
  assert.deepEqual(spyA.removedTabs, [10]);

  const withOtherWindow = {
    windows: [{ id: 1, state: 'normal' }, { id: 2, state: 'minimized' }],
    tabs: [{ id: 20, windowId: 2, url: 'https://example.com/' }]
  };
  const spyB = fakeChrome(withOtherWindow);
  const { closeTab: closeB } = await load();
  await closeB(20);
  assert.deepEqual(spyB.removedTabs, [20]);
});

test('the extension never creates or removes a window', async () => {
  // The structural invariant. Chrome quits when its window count reaches zero, so rather
  // than guarding every removal, the extension simply has no way to change that count.
  // These fakes explode if the capability is ever used again.
  const state = {
    windows: [{ id: 1, state: 'normal', focused: true }],
    tabs: [{ id: 10, windowId: 1, url: 'https://github.com/' }]
  };
  fakeChrome(state);
  chrome.windows.create = async () => { throw new Error('windows.create must never be called'); };
  chrome.windows.remove = async () => { throw new Error('windows.remove must never be called'); };

  chrome.tabs.reload = async () => {};
  const { findUsableWindow, findTabsForDomain, reloadTabs, closeTab } = await load();

  const windowId = await findUsableWindow();
  assert.equal(windowId, 1, 'borrows the window the user already has');

  await reloadTabs(await findTabsForDomain('github.com'));
  await closeTab(10);

  assert.equal(state.windows.length, 1, 'the window count never changed');
});

test('findUsableWindow prefers the focused window', async () => {
  const state = {
    windows: [
      { id: 1, state: 'normal', focused: false },
      { id: 2, state: 'normal', focused: true }
    ],
    tabs: []
  };
  fakeChrome(state);
  const { findUsableWindow } = await load();
  assert.equal(await findUsableWindow(), 2);
});

test('findUsableWindow returns null when the browser has no window open', async () => {
  // Server-side logout is then skipped and reported as skipped, rather than the extension
  // conjuring a window it would later have to dispose of.
  fakeChrome({ windows: [], tabs: [] });
  const { findUsableWindow } = await load();
  assert.equal(await findUsableWindow(), null);
});
