/**
 * Tests for reading "am I signed in" off the page.
 *
 * This is the last gap: a site the user was already signed into before installing has no
 * transition to observe and no federated round trip to catch, so visiting it proves
 * nothing — even though the page is, at that moment, displaying the answer.
 *
 * The asymmetry matters. Promotion is safe: a sign-out control is only ever rendered for
 * someone with a session to end. Dismissal is not, because an account menu that renders
 * only when opened shows neither control, and a signed-in user can be sitting on a
 * password-change form. A wrong dismissal hides a real account, so anything short of
 * "sign in offered, sign out absent" has to stay unknown.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LOGOUT_HREF, LOGOUT_TEXT, SIGNIN_TEXT, readPageEvidence } from '../src/core/page-signals.js';

const evidence = (over = {}) => ({
  logoutControls: 0,
  logoutHrefs: 0,
  signInControls: 0,
  passwordFields: 0,
  ...over
});

test('a sign-out control means signed in', () => {
  // The site stating the answer outright, rather than us inferring it from cookie names.
  assert.equal(readPageEvidence(evidence({ logoutControls: 1 })), 'signedIn');
});

test('a logout link inside a closed menu still counts', () => {
  // Plenty of sites render the account menu upfront and hide it with CSS. Requiring
  // visibility would miss them for no gain.
  assert.equal(readPageEvidence(evidence({ logoutHrefs: 1 })), 'signedIn');
});

test('sign-out outranks everything else on the page', () => {
  // A signed-in user on a password-change screen has both a password field and a sign-out
  // control. The sign-out control is the one that means something.
  assert.equal(
    readPageEvidence(evidence({ logoutControls: 1, passwordFields: 1, signInControls: 1 })),
    'signedIn'
  );
});

test('sign-in offered with no sign-out anywhere means anonymous', () => {
  assert.equal(readPageEvidence(evidence({ signInControls: 1 })), 'anonymous');
});

test('a login form alone is not enough to dismiss an account', () => {
  // A password field appears on password-change screens too. Dismissing on that would hide
  // a real account, which is the one error this must never make.
  assert.equal(readPageEvidence(evidence({ passwordFields: 1 })), 'unknown');
});

test('a page showing neither control stays unknown', () => {
  // An account menu that only renders when opened, or an article page with no chrome.
  assert.equal(readPageEvidence(evidence()), 'unknown');
});

test('missing counts are treated as zero rather than throwing', () => {
  assert.equal(readPageEvidence({}), 'unknown');
});

test('the text patterns match how sites actually word it', () => {
  for (const text of ['Sign out', 'Log out', 'Logout', 'SIGN OUT', 'log-out', 'Sign off']) {
    assert.ok(LOGOUT_TEXT.test(text), text);
  }

  // Anchored at the start but not at the end, because sites label the control with the
  // account it ends. X renders "Log out @handle", and demanding an exact match missed it.
  for (const text of ['Log out @someone', 'Sign out of all devices']) {
    assert.ok(LOGOUT_TEXT.test(text), text);
  }

  // Must not fire on prose that merely mentions signing out.
  for (const text of ['How to sign out of all devices', 'Signed out successfully', 'You were logged out']) {
    assert.equal(LOGOUT_TEXT.test(text), false, text);
  }

  for (const text of ['Sign in', 'Log in', 'Login', 'Sign up', 'Create account']) {
    assert.ok(SIGNIN_TEXT.test(text), text);
  }
});

test('logout hrefs are recognised across the usual spellings', () => {
  for (const href of ['/logout', '/sign-out', '/users/sign_out', '/auth/logout?next=/', '/signout#x']) {
    assert.ok(LOGOUT_HREF.test(href), href);
  }
  // A path that merely contains the word is not a logout endpoint.
  assert.equal(LOGOUT_HREF.test('/help/how-to-logout-everywhere'), false);
});
