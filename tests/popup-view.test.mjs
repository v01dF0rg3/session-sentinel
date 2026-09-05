import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountGroups, automationState, compactResult } from '../src/ui/popup-view.js';

test('missing account evidence never promotes cookie sites to Confirmed', () => {
  const sites = [{ domain: 'visitor.example' }];
  assert.deepEqual(accountGroups(sites).confirmed, []);
  assert.deepEqual(accountGroups(sites, null).other, sites);
  assert.deepEqual(accountGroups(sites, { used: ['visitor.example'] }).confirmed, []);
});

test('account categories are disjoint, retain kept sites, and require explicit evidence', () => {
  const sites = [
    { domain: 'confirmed.example' },
    { domain: 'kept-confirmed.example', mode: 'ignored' },
    { domain: 'candidate.example', needsConfirmation: true },
    { domain: 'question.example' },
    { domain: 'kept-visitor.example', mode: 'ignored', needsConfirmation: true },
    { domain: 'visitor.example' }
  ];
  const groups = accountGroups(sites, { confirmed: ['confirmed.example', 'kept-confirmed.example'], questions: ['question.example'] });
  assert.deepEqual(groups.confirmed.map((s) => s.domain), ['confirmed.example', 'kept-confirmed.example']);
  assert.deepEqual(groups.candidates.map((s) => s.domain), ['candidate.example', 'question.example']);
  assert.deepEqual(groups.other.map((s) => s.domain), ['kept-visitor.example', 'visitor.example']);
  assert.equal(new Set(Object.values(groups).flat()).size, sites.length);
});

test('explicit confirmation wins over a stale candidate marker', () => {
  const site = { domain: 'confirmed.example', needsConfirmation: true };
  assert.deepEqual(accountGroups([site], { confirmed: [site.domain], questions: [site.domain] }), { confirmed: [site], candidates: [], other: [] });
});

test('an active run has indeterminate copy, not invented progress or completion', () => {
  const result = compactResult({ status: 'running', sites: [] }, true);
  assert.equal(result.tone, 'busy');
  assert.match(result.title, /in progress/);
  assert.doesNotMatch(JSON.stringify(result), /%|signed out|safe|complete/i);
});

test('unfinished work remains attention-worthy even if completed sites look successful', () => {
  for (const report of [
    { status: 'running', sites: [{ outcome: 'cleared' }] },
    { status: 'complete', pending: ['unfinished.example'], sites: [{ outcome: 'cleared' }] }
  ]) {
    assert.equal(compactResult(report).tone, 'red');
    assert.match(compactResult(report).detail, /unfinished/);
  }
});

test('local failures are not hidden by website sign-out attempts', () => {
  const result = compactResult({ sites: [{ outcome: 'logoutAttempted' }, { outcome: 'failed' }, { outcome: 'revoked', localCleanup: { status: 'incomplete' } }] });
  assert.equal(result.tone, 'red');
  assert.match(result.title, /2 sites need attention/);
});

for (const outcome of ['logoutAttempted', 'loggedOut', 'revoked', 'cleared']) {
  test(`${outcome} never becomes an all-safe animation or result`, () => {
    const result = compactResult({ sites: [{ outcome, verified: true }] });
    assert.equal(result.tone, 'amber');
    assert.match(result.detail, /stolen tokens may still work/);
    assert.doesNotMatch(result.title, /revoked|safe|protected|signed out/i);
  });
}

test('empty and unrecognised reports do not claim a cleanup succeeded', () => {
  assert.match(compactResult(null).title, /No activity/);
  assert.match(compactResult({ sites: [] }).title, /No sites processed/);
  assert.match(compactResult({ sites: [{ outcome: 'unrecognised' }] }).title, /Review/);
});

test('setup, pause, no configured triggers, and active automation have distinct labels', () => {
  assert.equal(automationState({ enabled: true }).state, 'setup');
  assert.equal(automationState({ onboarded: true, enabled: false }).state, 'paused');
  assert.equal(automationState({ onboarded: true, enabled: true }).state, 'off');
  for (const trigger of ['onIdle', 'onLock', 'onBrowserClose']) {
    assert.equal(automationState({ onboarded: true, enabled: true, [trigger]: { enabled: true } }).state, 'on');
  }
});
