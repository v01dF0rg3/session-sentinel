/**
 * Tests for telling an authenticated session from an anonymous one.
 *
 * Three earlier rules tried to read authentication out of a cookie's name and flags, and
 * each one fixed the reported site while staying wrong. The data that settled it:
 * bloomberg.com hands a stranger `_session_id_backup` — httpOnly, Secure, 36-char opaque
 * value — before anyone signs in. It is a real session cookie belonging to nobody.
 *
 * The empty-Incognito measurement proved that the name is ambiguous, not that the normal
 * session behind the same name is logged out. These tests pin that distinction so a future
 * implementation cannot accidentally turn equal name sets into an anonymous verdict.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { judgeSignIn } from '../src/core/anon-baseline.js';

test('an auth-looking name also seen in Incognito remains unknown', () => {
  // Measured on Bloomberg in Chrome 152. The same name exists in a genuinely empty
  // private jar, but Bloomberg could upgrade that name's server-side session after login.
  assert.equal(judgeSignIn(['_session_id_backup'], null), 'unknown');
});

test('extra normal-profile names are not retrospectively called accounts', () => {
  // GitHub usually adds user_session and dotcom_user after login, but if the extension was
  // installed afterwards it did not observe that transition. A homepage probe may also
  // miss anonymous names set on deeper routes, so absence there is not confirmation.
  assert.equal(judgeSignIn(['_gh_sess', 'user_session', 'dotcom_user'], null), 'unknown');
});

test('with nothing ruled out, the answer is unknown rather than yes', () => {
  // Guessing "signed in" from an unexamined session cookie is exactly what put
  // bloomberg.com on a list headed SIGNED IN.
  assert.equal(judgeSignIn(['_session_id_backup'], null), 'unknown');
});

test('no session-looking cookies at all is a plain no, not an unknown', () => {
  assert.equal(judgeSignIn([], null), 'anonymous');
});

test('what was already there at first sight is a question, not a no', () => {
  // The error that emptied the list twice. A first-sight baseline is NOT proof of
  // anonymity: for someone already signed in when the extension was installed, their real
  // auth cookie is sitting in it. "Everything you have was there at first sight" means we
  // cannot tell — so it becomes a question for the user, never a silent dismissal.
  const verdict = judgeSignIn(['nonsession', 'dp1'], ['nonsession', 'dp1']);
  assert.equal(verdict, 'unknown');
});

test('a value rotation hidden behind the same name cannot be inferred', () => {
  // chrome.cookies gives the value, but anonymous sessions rotate too and some sites
  // upgrade a server-side record without changing it. The safe evidence is names only.
  assert.equal(judgeSignIn(['session_id'], ['session_id']), 'unknown');
});

test('a new cookie appearing after first sight is a sign-in', () => {
  const verdict = judgeSignIn(['nonsession', 'dp1', 'ebay_session'], ['nonsession', 'dp1']);
  assert.equal(verdict, 'signedIn');
});

test('first sight treats names as a set, not an order-sensitive fingerprint', () => {
  assert.equal(judgeSignIn(['b', 'a'], ['a', 'b']), 'unknown');
  assert.equal(judgeSignIn(['b', 'a', 'new'], ['a', 'b']), 'signedIn');
});

test('an empty first-sight record is evidence; a missing one is not', () => {
  // [] says "this domain had no auth cookies when we first looked", which makes any auth
  // cookie now a sign-in. null says "we have never looked". Collapsing the two would make
  // every unseen site look signed in.
  assert.equal(judgeSignIn(['user_session'], []), 'signedIn');
  assert.equal(judgeSignIn(['user_session'], null), 'unknown');
});

test('a first-sight record written this instant must not judge itself', () => {
  // The bug this caught, stated as an invariant. On a first scan the baseline is written
  // from the very cookies being judged, so subtracting it leaves nothing and every site
  // grades anonymous. Worse than a wrong answer: nothing is left marked unknown, so the
  // probe that would settle it never runs. The list came back holding one entry.
  const jar = ['user_session', '_gh_sess'];
  assert.equal(judgeSignIn(jar, jar), 'unknown', 'judging itself proves nothing');
  assert.equal(judgeSignIn(jar, null), 'unknown', 'and a first sighting proves nothing');
  assert.equal(
    judgeSignIn([...jar, 'arrived_later'], jar),
    'signedIn',
    'only a cookie that appeared afterwards is evidence'
  );
});

// --- the first-sight record, against fake storage ------------------------------------

function fakeStorage(initial = {}) {
  const bag = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: bag[key] }),
        set: async (obj) => Object.assign(bag, obj)
      }
    }
  };
  return bag;
}

test('first sight names which domains are new, and never revises one', async () => {
  fakeStorage();
  const { recordFirstSight } = await import('../src/platform/first-sight.js');

  const first = await recordFirstSight([{ domain: 'a.example', authNames: ['sid'] }]);
  assert.deepEqual([...first.added], ['a.example'], 'new on the pass that records it');

  // A later scan, after the user signs in and a second cookie appears.
  const second = await recordFirstSight([
    { domain: 'a.example', authNames: ['sid', 'auth_token'] },
    { domain: 'b.example', authNames: ['sid'] }
  ]);

  assert.deepEqual([...second.added], ['b.example'], 'a.example is no longer new');
  assert.deepEqual(
    second.sight['a.example'],
    ['sid'],
    'the record describes the world before we were watching, so it is never overwritten'
  );
  assert.equal(
    judgeSignIn(['sid', 'auth_token'], second.sight['a.example']),
    'signedIn',
    'the cookie that arrived after first sight is the sign-in'
  );
});

// --- the user's own answer -----------------------------------------------------------

test('a stated answer is remembered and can be taken back', async () => {
  // The escape hatch that lets the automatic rules be imperfect. Four rules in a row were
  // wrong from cookies alone; "I have never made an eBay account" is not a heuristic
  // anyone can improve on, so it is respected permanently rather than re-derived.
  fakeStorage();
  const { getVerdicts, setVerdict } = await import('../src/platform/site-verdict.js');

  await setVerdict('bloomberg.com', 'notMine');
  await setVerdict('github.com', 'mine');
  assert.deepEqual(await getVerdicts(), { 'bloomberg.com': 'notMine', 'github.com': 'mine' });

  await setVerdict('bloomberg.com', null);
  assert.deepEqual(await getVerdicts(), { 'github.com': 'mine' }, 'null forgets it');
});

// --- baselining at page load ---------------------------------------------------------

test('a visit records the site as it looks before signing in', async () => {
  // The whole point. Baselining only when the popup opens misses the ordinary case:
  // someone arrives at a site and signs in within the same minute, so the auth cookie is
  // already present when the baseline is written and the site can never be more than a
  // question. Captured at page load, the sign-in that follows confirms itself.
  const bag = fakeStorage();
  globalThis.chrome.cookies = {
    getAll: async () => [
      { name: '_gh_sess', value: 'x'.repeat(32), httpOnly: true, secure: true },
      { name: '_ga', value: 'GA1.2.3', httpOnly: false, secure: false }
    ]
  };

  const { baselineOnVisit } = await import('../src/platform/first-sight.js');
  assert.equal(await baselineOnVisit('github.com'), true);
  assert.deepEqual(bag.firstSight['github.com'], ['_gh_sess'], 'auth-grade names only');

  // The sign-in a minute later is a name that was not there before.
  assert.equal(judgeSignIn(['_gh_sess', 'user_session'], bag.firstSight['github.com']), 'signedIn');
});

test('a domain with no cookies is never recorded', async () => {
  // This is what keeps the record from becoming a browsing history. Every fact stored is
  // already readable from chrome.cookies.getAll; a bare visit must not add one.
  const bag = fakeStorage();
  globalThis.chrome.cookies = { getAll: async () => [] };

  const { baselineOnVisit } = await import('../src/platform/first-sight.js');
  assert.equal(await baselineOnVisit('never-visited.example'), false);
  assert.equal(bag.firstSight, undefined, 'nothing was written at all');
});
