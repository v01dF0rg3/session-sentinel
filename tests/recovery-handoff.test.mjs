import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryHandoff, recoveryDomain, recoveryHandoffText } from '../src/core/recovery-handoff.js';
import { buildRecoveryPlan } from '../src/core/compromise.js';
import { DEFAULT_SETTINGS } from '../src/core/policy.js';
import { RECOVERY_BASELINE, RECOVERY_STEPS } from '../data/recovery-checklist.js';

const AT = Date.UTC(2026, 8, 4, 12);
const group = (...steps) => [{ steps }];
const account = (domain, tier = 'critical') => ({ domain, tier, unverified: false });

test('a portable plan includes only explicitly confirmed accounts', () => {
  const plan = createRecoveryHandoff(group(
    account('google.com'),
    { ...account('bloomberg.com', 'low'), unverified: true },
    { domain: 'unknown.com', tier: 'critical' },
    { ...account('ambiguous.com'), unverified: 'false' }
  ), AT);
  assert.deepEqual(plan.accounts, [{ domain: 'google.com', tier: 'critical', evidence: 'confirmed' }]);
});

test('cookie values, usernames, URLs and completed ticks cannot enter the portable data', () => {
  const input = group({
    ...account('github.com'), username: 'private-user', email: 'private@example.com',
    cookies: [{ name: 'private-cookie-name', value: 'private-token' }],
    siteUrl: 'https://attacker.com', sessionsUrl: 'https://attacker.com/reset?secret=private-token',
    passwordUrl: 'https://attacker.com', sharesSignInWith: ['private.other.com'],
    done: true, reviewed: true
  });
  const before = structuredClone(input);
  const plan = createRecoveryHandoff(input, AT);
  assert.deepEqual(plan, { version: 1, generatedAt: AT, accounts: [{ domain: 'github.com', tier: 'critical', evidence: 'confirmed' }], excludedCount: 0 });
  const output = JSON.stringify(plan) + recoveryHandoffText(plan);
  for (const secret of ['private-user', 'private@example.com', 'private-cookie-name', 'private-token', 'attacker.com', 'private.other.com']) {
    assert.ok(!output.includes(secret), `${secret} must not leave the browser`);
  }
  assert.ok(!output.includes('[x]'), 'previous progress is never exported as verified work');
  assert.deepEqual(input, before, 'export must not mutate the live recovery plan');
});

test('the domain gate rejects URLs, account identifiers, local addresses and injected text', () => {
  for (const value of [
    'https://google.com', 'google.com/path', 'google.com?token=secret', 'google.com#secret',
    'user@google.com', 'google.com:443', 'google.com\nattacker.com', 'google.com\r',
    'google.com\u202e', '<img src=x>', 'localhost', '127.0.0.1', '[::1]',
    'host.local', 'host.internal', 'host.invalid', 'host.test', 'host.example',
    ' google.com', 'google.com ', '.google.com', 'google.com.', '-bad.com',
    'a'.repeat(64) + '.com', null, {}, ['google.com']
  ]) assert.equal(recoveryDomain(value), null, String(value));
  const plan = createRecoveryHandoff(group(account('https://google.com'), account('bank.com\nsecret')), AT);
  assert.equal(plan.excludedCount, 2);
  assert.equal(plan.accounts.length, 0);
  assert.ok(!recoveryHandoffText(plan).includes('bank.com'));
});

test('domains are normalized, reduced and deduplicated while keeping the higher risk', () => {
  assert.equal(recoveryDomain('LOGIN.Example.CO.UK'), 'example.co.uk');
  assert.equal(recoveryDomain('customer.github.io'), 'customer.github.io');
  assert.equal(recoveryDomain('xn--bcher-kva.de'), 'xn--bcher-kva.de');
  const plan = createRecoveryHandoff(group(account('accounts.google.com', 'high'), account('GOOGLE.COM')), AT);
  assert.deepEqual(plan.accounts, [{ domain: 'google.com', tier: 'critical', evidence: 'confirmed' }]);
});

test('unknown risk values fail closed and never become export text', () => {
  const plan = createRecoveryHandoff(group(account('google.com', 'critical\nsecret'), account('github.com', 'constructor')), AT);
  assert.equal(plan.excludedCount, 2);
  assert.equal(plan.accounts.length, 0);
});

test('all-tier handoff keeps low-risk confirmed accounts and respects recovery priority', () => {
  const domains = ['chess.com', 'github.com', 'google.com', 'chase.com', 'bloomberg.com'];
  const all = buildRecoveryPlan(domains, DEFAULT_SETTINGS, 'low', new Set(), new Set(['bloomberg.com']));
  const plan = createRecoveryHandoff(all, AT);
  assert.deepEqual(plan.accounts.map((item) => item.domain), ['google.com', 'chase.com', 'github.com', 'chess.com']);
  assert.match(recoveryHandoffText(plan), /chess\.com \| low risk \| confirmed/);
});

test('an empty plan still includes every essential account category and recovery step', () => {
  const text = recoveryHandoffText(createRecoveryHandoff([], AT));
  for (const item of [...RECOVERY_BASELINE, ...RECOVERY_STEPS]) assert.ok(text.includes(item.title));
  assert.match(text, /No confirmed account domains were available/);
  assert.match(text, /incomplete or altered/);
  assert.match(text, /trusted phone or computer/);
  assert.match(text, /Only|only on a trusted device/);
  assert.doesNotMatch(text, /nothing to do|all accounts are secure|https?:\/\//i);
});

test('invalid snapshots fail explicitly rather than claiming the account list is empty', () => {
  for (const invalid of [NaN, Infinity, 9e16]) assert.throws(() => createRecoveryHandoff([], invalid));
  assert.throws(() => createRecoveryHandoff(null, AT));
  assert.throws(() => createRecoveryHandoff([{}], AT));
});

test('large inventories are not silently truncated', () => {
  const input = group(...Array.from({ length: 250 }, (_, i) => account(`service-${i}.com`, 'low')));
  const plan = createRecoveryHandoff(input, AT);
  assert.equal(plan.accounts.length, 250);
  const text = recoveryHandoffText(plan);
  for (const item of plan.accounts) assert.ok(text.includes(`[ ] ${item.domain} |`));
});
