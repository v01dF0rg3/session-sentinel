/**
 * Tests for breach recovery ordering.
 *
 * The order is the whole feature. Securing a bank before the mailbox that receives its
 * password-reset link is wasted work — the attacker resets it again — so a plan that gets
 * the order wrong is worse than no plan, because it feels like progress.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRecoveryPlan, countSteps, recoveryCategory, recoveryProgress } from '../src/core/compromise.js';
import { DEFAULT_SETTINGS, withDefaults } from '../src/core/policy.js';

const plan = (domains, minTier) => buildRecoveryPlan(domains, DEFAULT_SETTINGS, minTier);

test('sites are sorted into recovery categories', () => {
  assert.equal(recoveryCategory('gmail.com'), 'identity');
  assert.equal(recoveryCategory('1password.com'), 'identity');
  assert.equal(recoveryCategory('chase.com'), 'finance');
  assert.equal(recoveryCategory('github.com'), 'infrastructure');
  assert.equal(recoveryCategory('facebook.com'), 'communication');
  assert.equal(recoveryCategory('somerandomblog.net'), 'other');
});

test('unlisted sites fall back to keywords', () => {
  assert.equal(recoveryCategory('firstnationalbank.example'), 'finance');
  assert.equal(recoveryCategory('webmail.example'), 'identity');
  assert.equal(recoveryCategory('deploy-console.example'), 'infrastructure');
});

test('identity comes first, whatever the risk tiers say', () => {
  // This is the point of the feature. chase.com and google.com are both 'critical', so
  // tier alone cannot order them - but securing the bank first is useless while the
  // attacker still holds the mailbox its reset email goes to.
  const groups = plan(['chase.com', 'google.com', 'github.com', 'facebook.com']);
  assert.deepEqual(
    groups.map((g) => g.category),
    ['identity', 'finance', 'infrastructure', 'communication']
  );
  assert.equal(groups[0].steps[0].domain, 'google.com');
});

test('low-value sites are left out, so the list can actually be finished', () => {
  // A breach response listing two hundred forums is one nobody completes, and an
  // unfinished recovery leaves the important accounts unsecured just the same.
  const groups = plan(['chase.com', 'somerandomblog.net', 'youtube.com']);
  const domains = groups.flatMap((g) => g.steps.map((s) => s.domain));

  assert.ok(domains.includes('chase.com'));
  assert.ok(!domains.includes('somerandomblog.net'), 'low tier is excluded by default');
  assert.ok(!domains.includes('youtube.com'));

  // ...but the threshold is a parameter, for someone who wants everything.
  const everything = plan(['chase.com', 'somerandomblog.net'], 'low');
  assert.equal(countSteps(everything), 2);
});

test('a shared sign-in is flagged so the user does not hunt for a second password page', () => {
  const groups = plan(['google.com', 'youtube.com'], 'low');
  const google = groups.flatMap((g) => g.steps).find((s) => s.domain === 'google.com');
  assert.deepEqual(google.sharesSignInWith, ['youtube.com']);
});

test('a shared sign-in is only flagged when the user actually uses both', () => {
  const groups = plan(['google.com'], 'low');
  const google = groups.flatMap((g) => g.steps).find((s) => s.domain === 'google.com');
  assert.deepEqual(google.sharesSignInWith, [], 'no point naming accounts they do not have');
});

test('every step has somewhere to go, even with no known password page', () => {
  const groups = plan(['chase.com', 'github.com']);
  for (const step of groups.flatMap((g) => g.steps)) {
    assert.ok(step.siteUrl, `${step.domain} has no destination`);
    assert.match(step.siteUrl, /^https:\/\//);
  }
  const github = groups.flatMap((g) => g.steps).find((s) => s.domain === 'github.com');
  assert.equal(github.passwordUrl, 'https://github.com/settings/security');
});

test('the never-clear list does not exclude an account from recovery', () => {
  // That list governs what may be destroyed. Recovery destroys nothing - it opens
  // password pages - and a compromised account the user asked not to log out of is
  // still a compromised account.
  const settings = withDefaults({ sites: { 'chase.com': { mode: 'ignored' } } });
  const groups = buildRecoveryPlan(['chase.com'], settings, 'high');
  assert.equal(countSteps(groups), 1);
});

test('progress tracks position and names what is next', () => {
  const groups = plan(['google.com', 'chase.com', 'github.com']);
  const all = groups.flatMap((g) => g.steps.map((s) => s.domain));

  const start = recoveryProgress(groups, []);
  assert.equal(start.done, 0);
  assert.equal(start.total, 3);
  assert.equal(start.nextDomain, all[0], 'starts at the top of the ordered plan');

  const midway = recoveryProgress(groups, [all[0]]);
  assert.equal(midway.done, 1);
  assert.equal(midway.nextDomain, all[1]);

  const finished = recoveryProgress(groups, all);
  assert.equal(finished.done, 3);
  assert.equal(finished.nextDomain, null);
});

test('each group explains why it is where it is', () => {
  const groups = plan(['google.com', 'chase.com']);
  assert.match(groups[0].why, /reset through them/);
  assert.ok(groups.every((g) => g.label && g.why));
});
