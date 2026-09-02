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

test('what was already there the first time counts as anonymous too', () => {
  // A homepage fetch does not see every cookie a site sets across a whole visit - eBay's
  // `nonsession` arrives deeper than the front page. Anything present before we could have
  // watched a sign-in predates it and proves nothing.
  const verdict = judgeSignIn(['nonsession', 'dp1'], null, ['nonsession', 'dp1']);
  assert.equal(verdict, 'anonymous');
});

test('a new cookie appearing after first sight is a sign-in', () => {
  const verdict = judgeSignIn(['nonsession', 'dp1', 'ebay_session'], null, ['nonsession', 'dp1']);
  assert.equal(verdict, 'signedIn');
});

test('the two sources of doubt combine rather than override each other', () => {
  // The probe missed a cookie; first sight caught it. Neither alone is enough.
  const partial = baselineFrom(['_gh_sess']);
  assert.equal(judgeSignIn(['_gh_sess', '_octo'], partial), 'signedIn', 'probe alone is fooled');
  assert.equal(judgeSignIn(['_gh_sess', '_octo'], partial, ['_octo']), 'anonymous');
});

test('an empty probe result is not mistaken for a site that sets no cookies', () => {
  // A failed fetch and a genuinely cookie-free site look identical from here, so neither
  // is allowed to confirm anything.
  const failed = baselineFrom([]);
  assert.equal(failed.usable, false);
  assert.equal(judgeSignIn(['session_token'], failed), 'unknown');
});

test('a baseline recorded this instant rules out everything, so it must not be used yet', () => {
  // The bug this caught, stated as an invariant. On a first scan the baseline is written
  // from the very cookies being judged, so subtracting it leaves nothing and every site
  // grades anonymous. Worse than a wrong answer: nothing is left marked unknown, so the
  // probe that would settle it never runs. The list came back holding one entry.
  const jar = ['user_session', '_gh_sess'];
  assert.equal(judgeSignIn(jar, null, jar), 'anonymous', 'what the caller must not do');
  assert.equal(judgeSignIn(jar, null, []), 'unknown', 'what a first sighting means');
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
