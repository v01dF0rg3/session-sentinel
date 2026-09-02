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

const plan = (domains, minTier, frequent) => buildRecoveryPlan(domains, DEFAULT_SETTINGS, minTier, frequent);

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

test('frequency breaks ties but never outranks sensitivity', () => {
  // The distinction that keeps this honest. A site visited daily is not more dangerous to
  // lose than one visited twice a year, so frequency must never promote a lower tier past
  // a higher one. Within a tier it is a good signal: secure the account you live in first.
  const frequent = new Set(['github.com']);

  // Same category, same tier: the frequently-used one comes first.
  const tied = plan(['github.com', 'gitlab.com'], 'high', frequent);
  assert.deepEqual(tied[0].steps.map((s) => s.domain), ['github.com', 'gitlab.com']);

  // Without the signal it falls back to alphabetical, which puts them the other way.
  const untied = plan(['github.com', 'gitlab.com'], 'high');
  assert.deepEqual(untied[0].steps.map((s) => s.domain), ['github.com', 'gitlab.com']);

  // Across tiers, sensitivity still wins. github.com is frequently used and demoted to
  // 'high'; gitlab.com is untouched at 'critical'. The critical one must still come first.
  const settings = withDefaults({ sites: { 'github.com': { tier: 'high', mode: 'default' } } });
  const acrossTiers = buildRecoveryPlan(['github.com', 'gitlab.com'], settings, 'high', frequent);
  assert.deepEqual(
    acrossTiers[0].steps.map((s) => s.domain),
    ['gitlab.com', 'github.com'],
    'critical outranks frequent'
  );
});

test('steps say whether the user visits the site often', () => {
  const groups = plan(['github.com'], 'high', new Set(['github.com']));
  assert.equal(groups[0].steps[0].frequent, true);

  const without = plan(['github.com'], 'high');
  assert.equal(without[0].steps[0].frequent, false, 'defaults to false with no permission');
});

test('each group explains why it is where it is', () => {
  const groups = plan(['google.com', 'chase.com']);
  assert.match(groups[0].why, /reset or unlock many other accounts/);
  assert.ok(groups.every((g) => g.label && g.why));
});

test('unverified candidates are included, and ranked below confirmed accounts', () => {
  // Being strict here once emptied the plan entirely: on a fresh profile nothing is
  // confirmed yet, so "Been hacked?" produced zero steps and told a possibly-breached user
  // to browse a little and come back. The costs are reversed from the popup — a wrong row
  // here is a password page you glance at and skip; a missing row is an account that never
  // comes up during a breach.
  const groups = buildRecoveryPlan(
    ['github.com', 'gitlab.com'],
    DEFAULT_SETTINGS,
    'high',
    new Set(),
    new Set(['github.com'])
  );

  const steps = groups.flatMap((g) => g.steps);
  assert.equal(steps.length, 2, 'the candidate is not dropped');
  assert.deepEqual(
    steps.map((s) => s.domain),
    ['gitlab.com', 'github.com'],
    'confirmed first, guesses at the bottom of the tier where they can be skipped'
  );
  assert.equal(steps[1].unverified, true, 'and it says which it is');
  assert.equal(steps[0].unverified, false);
});

test('sensitivity still outranks confirmation', () => {
  // An unverified critical account must not sit below a confirmed high-risk one. The
  // question is how sure we are that it is an account, not how dangerous it would be.
  const settings = withDefaults({ sites: { 'gitlab.com': { tier: 'high', mode: 'default' } } });
  const groups = buildRecoveryPlan(
    ['github.com', 'gitlab.com'],
    settings,
    'high',
    new Set(),
    new Set(['github.com'])
  );
  assert.deepEqual(
    groups.flatMap((g) => g.steps).map((s) => s.domain),
    ['github.com', 'gitlab.com']
  );
});
