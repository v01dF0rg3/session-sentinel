import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearLoginIntent,
  getLoginIntent,
  loginIntentTabIds,
  loginIntentTabsForDomain,
  markLoginEntryAttempted,
  rememberLoginIntent
} from '../src/platform/login-intent.js';

function fakeSession(initial = {}) {
  const state = { ...initial };
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: state[key] }; },
        async set(value) { Object.assign(state, value); },
        async remove(key) { delete state[key]; }
      }
    }
  };
  return state;
}

test('a login intent survives worker state, advances, and clears with its tab', async () => {
  fakeSession();
  await rememberLoginIntent(42, 'example.com');
  assert.equal((await getLoginIntent(42))?.attemptedEntry, false);

  await markLoginEntryAttempted(42);
  assert.equal((await getLoginIntent(42))?.attemptedEntry, true);
  assert.deepEqual(await loginIntentTabsForDomain('example.com'), [42]);
  assert.deepEqual(await loginIntentTabIds(), [42]);

  await clearLoginIntent(42);
  assert.equal(await getLoginIntent(42), null);
});

test('expired login intents are ignored', async () => {
  fakeSession({
    pendingLoginIntents: {
      7: { domain: 'old.example', attemptedEntry: false, at: Date.now() - 31 * 60 * 1000 }
    }
  });
  assert.equal(await getLoginIntent(7), null);
  assert.deepEqual(await loginIntentTabsForDomain('old.example'), []);
  assert.deepEqual(await loginIntentTabIds(), []);
});
