/**
 * Tests for telling an authenticated session from an anonymous one.
 *
 * Three earlier rules tried to read authentication out of a cookie's name and flags, and
 * each one fixed the reported site while staying wrong. The data that settled it:
 * bloomberg.com hands a stranger `_session_id_backup` — httpOnly, Secure, 36-char opaque
 * value — before anyone signs in. It is a real session cookie belonging to nobody.
 *
 * So the fixtures here are measured, not invented. Every cookie set below was taken from an
 * actual credentials-omitted fetch of the site.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baselineFrom, judgeSignIn } from '../src/core/anon-baseline.js';

// Measured 1 September 2026, fetched with no cookies.
const BLOOMBERG = baselineFrom(['_pxhd', 'session_id', '_session_id_backup', 'agent_id', 'session_key']);
const GITHUB = baselineFrom(['_gh_sess', '_octo', 'logged_in']);

test('a site whose session cookies are handed to strangers is not an account', () => {
  // The whole reason this file exists. Every session-looking cookie bloomberg.com sets is
  // one you get for showing up, so a jar containing exactly those proves nothing.
  const verdict = judgeSignIn(['_session_id_backup', 'session_id', 'session_key'], BLOOMBERG);
  assert.equal(verdict, 'anonymous');
});

test('cookies a stranger never receives are what an account looks like', () => {
  // A signed-in GitHub user has the stranger's three plus their own.
  const verdict = judgeSignIn(['_gh_sess', 'user_session', 'dotcom_user'], GITHUB);
  assert.equal(verdict, 'signedIn');
});

test('with nothing ruled out, the answer is unknown rather than yes', () => {
  // Guessing "signed in" from an unexamined session cookie is exactly what put
  // bloomberg.com on a list headed SIGNED IN.
  assert.equal(judgeSignIn(['_session_id_backup'], null), 'unknown');
  assert.equal(judgeSignIn(['_session_id_backup'], { anonymous: [], usable: false }), 'unknown');
});

test('no session-looking cookies at all is a plain no, not an unknown', () => {
  assert.equal(judgeSignIn([], null), 'anonymous');
});

test('what was already there at first sight is a question, not a no', () => {
  // The error that emptied the list twice. A first-sight baseline is NOT proof of
  // anonymity: for someone already signed in when the extension was installed, their real
  // auth cookie is sitting in it. "Everything you have was there at first sight" means we
  // cannot tell — so it becomes a question for the user, never a silent dismissal.
  const verdict = judgeSignIn(['nonsession', 'dp1'], null, ['nonsession', 'dp1']);
  assert.equal(verdict, 'unknown');
});

test('only the stranger list can rule an account out', () => {
  // First sight can promote, never dismiss. Only cookies known to be handed to people with
  // no account can prove there is no account.
  assert.equal(judgeSignIn(['session_id'], BLOOMBERG, ['session_id']), 'anonymous');
  assert.equal(judgeSignIn(['session_id'], null, ['session_id']), 'unknown');
});

test('a new cookie appearing after first sight is a sign-in', () => {
  const verdict = judgeSignIn(['nonsession', 'dp1', 'ebay_session'], null, ['nonsession', 'dp1']);
  assert.equal(verdict, 'signedIn');
});

test('the two sources combine, with first sight only ever promoting', () => {
  // The probe missed `_octo`, so on its own it reports an account that is not there.
  const partial = baselineFrom(['_gh_sess']);
  assert.equal(judgeSignIn(['_gh_sess', '_octo'], partial), 'signedIn', 'probe alone is fooled');

  // First sight knows `_octo` was always present, which removes the false remainder. The
  // two sources now disagree — the probe calls `_octo` unexplained, first sight calls it
  // old — and a disagreement is a question, not a verdict.
  assert.equal(judgeSignIn(['_gh_sess', '_octo'], partial, ['_gh_sess', '_octo']), 'unknown');
});

test('an empty probe result is not mistaken for a site that sets no cookies', () => {
  // A failed fetch and a genuinely cookie-free site look identical from here, so neither
  // is allowed to confirm anything.
  const failed = baselineFrom([]);
  assert.equal(failed.usable, false);
  assert.equal(judgeSignIn(['session_token'], failed), 'unknown');
});

test('an empty first-sight record is evidence; a missing one is not', () => {
  // [] says "this domain had no auth cookies when we first looked", which makes any auth
  // cookie now a sign-in. null says "we have never looked". Collapsing the two would make
  // every unseen site look signed in.
  assert.equal(judgeSignIn(['user_session'], null, []), 'signedIn');
  assert.equal(judgeSignIn(['user_session'], null, null), 'unknown');
});

test('a baseline recorded this instant rules out everything, so it must not be used yet', () => {
  // The bug this caught, stated as an invariant. On a first scan the baseline is written
  // from the very cookies being judged, so subtracting it leaves nothing and every site
  // grades anonymous. Worse than a wrong answer: nothing is left marked unknown, so the
  // probe that would settle it never runs. The list came back holding one entry.
  const jar = ['user_session', '_gh_sess'];
  assert.equal(judgeSignIn(jar, null, jar), 'unknown', 'judging itself proves nothing');
  assert.equal(judgeSignIn(jar, null, null), 'unknown', 'and a first sighting proves nothing');
  assert.equal(
    judgeSignIn([...jar, 'arrived_later'], null, jar),
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
    judgeSignIn(['sid', 'auth_token'], null, second.sight['a.example']),
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
