/**
 * Tests for the pure decision logic. Run with: node --test tests/
 *
 * These cover the code that decides what gets destroyed. That logic is deliberately
 * free of chrome.* calls so it can be tested without a browser - which matters, because
 * a bug here silently wipes data the user asked us to leave alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registrableDomain } from '../src/core/domain.js';
import { atLeast, classify, looksLikeSessionCookie } from '../src/core/risk.js';
import { buildPlan, resolveTier } from '../src/core/plan.js';
import { expandForIdentity } from '../src/core/identity.js';
import { DEFAULT_SETTINGS, withDefaults } from '../src/core/policy.js';
import { findRecipe, heuristicRecipe, isValidRecipe, RECIPES } from '../src/core/recipes.js';
import { compromiseAdviceFor, revokeGuidanceFor, sessionPageFor } from '../src/core/session-pages.js';

test('registrable domain handles multi-label suffixes', () => {
  assert.equal(registrableDomain('mail.google.com'), 'google.com');
  assert.equal(registrableDomain('.www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('deep.sub.example.com.au'), 'example.com.au');
  assert.equal(registrableDomain('me.github.io'), 'me.github.io');
  assert.equal(registrableDomain('192.168.0.1'), '192.168.0.1');
});

test('classification covers listed sites, subdomains, suffixes and keywords', () => {
  assert.equal(classify('chase.com').tier, 'critical');
  assert.equal(classify('console.aws.amazon.com').tier, 'high', 'inherits from amazon.com');
  assert.equal(classify('irs.gov').tier, 'critical');
  assert.equal(classify('anytown.gov').tier, 'critical', 'gov TLD');
  assert.equal(classify('firstnationalbank.example').tier, 'critical', 'keyword');
  assert.equal(classify('somerandomblog.net').tier, 'low');
});

test('tier ordering', () => {
  assert.ok(atLeast('critical', 'high'));
  assert.ok(atLeast('high', 'high'));
  assert.ok(!atLeast('low', 'medium'));
});

test('session cookie heuristic catches real-world session cookie names', () => {
  for (const name of [
    'sessionid',        // Django
    'PHPSESSID',        // PHP
    'JSESSIONID',       // Java
    'connect.sid',      // Express
    '__Host-auth_token',
    '__Secure-1PSID',
    'wordpress_logged_in_abc123',
    'access_token',
    'remember_me'
  ]) {
    assert.ok(looksLikeSessionCookie(name), `${name} should read as a session cookie`);
  }

  for (const name of ['_ga', '_fbp', 'theme_preference', 'consent', 'build_id', 'locale']) {
    assert.ok(!looksLikeSessionCookie(name), `${name} should not read as a session cookie`);
  }
});

// Automatic triggers are inert until onboarding is acknowledged, so tests that exercise
// them opt in the way a real user does.
const READY = withDefaults({ onboarded: true });

test('default plan on browser close protects high and critical only', () => {
  const plan = buildPlan(
    ['chase.com', 'slack.com', 'netflix.com', 'somerandomblog.net'],
    'browserClose',
    READY
  );
  assert.deepEqual(plan.targets.map((t) => t.domain), ['chase.com', 'slack.com']);
  assert.equal(plan.skipped.length, 2);
});

test('manual run reaches every tier', () => {
  const plan = buildPlan(['chase.com', 'netflix.com', 'somerandomblog.net'], 'manual', READY);
  assert.equal(plan.targets.length, 3);
});

test('ignored sites survive automatic triggers and manual "log out everywhere"', () => {
  const settings = withDefaults({ onboarded: true, sites: { 'chase.com': { mode: 'ignored' } } });

  for (const trigger of ['browserClose', 'idle', 'lock', 'manual']) {
    const plan = buildPlan(['chase.com'], /** @type {any} */ (trigger), settings);
    assert.equal(plan.targets.length, 0, `${trigger} must skip ignored sites`);
  }

  // ...but an explicit per-site action still reaches it.
  const explicit = buildPlan(['chase.com'], 'manualSite', settings);
  assert.equal(explicit.targets.length, 1);
});

test('a site marked "never clear" is never cleared, whatever fires', () => {
  // The user ticks "Never clear this site" on youtube.com. Nothing automatic, and no
  // press of "Log out of all sessions", may touch it - including when it is swept up in
  // a run alongside sites that DO get cleared.
  const settings = withDefaults({ onboarded: true, sites: { 'youtube.com': { mode: 'ignored' } } });
  const alongside = ['chase.com', 'youtube.com', 'github.com'];

  for (const trigger of ['manual', 'browserClose', 'idle', 'lock']) {
    const plan = buildPlan(alongside, /** @type {any} */ (trigger), settings);
    const domains = plan.targets.map((t) => t.domain);
    assert.ok(!domains.includes('youtube.com'), `${trigger} must not touch a kept site`);
    assert.ok(
      plan.skipped.some((s) => s.domain === 'youtube.com'),
      `${trigger} must report the kept site as skipped rather than silently dropping it`
    );
  }

  // Other sites in the same run are unaffected.
  const manual = buildPlan(alongside, 'manual', settings);
  assert.deepEqual(manual.targets.map((t) => t.domain).sort(), ['chase.com', 'github.com']);

  // Clearing it by hand from the popup still works - keeping a site must not lock the
  // user out of clearing it deliberately.
  assert.equal(buildPlan(['youtube.com'], 'manualSite', settings).targets.length, 1);
});

test('protected sites are escalated to critical and wiped deeply', () => {
  const settings = withDefaults({ onboarded: true, sites: { 'somerandomblog.net': { mode: 'protected' } } });
  const { tier } = resolveTier('somerandomblog.net', settings);
  assert.equal(tier, 'critical');

  const plan = buildPlan(['somerandomblog.net'], 'browserClose', settings);
  assert.equal(plan.targets[0].depth, 'deep');
  assert.ok(plan.targets[0].dataTypes.includes('indexedDB'));
});

test('defaults reload open tabs so a logout is visible', () => {
  // The logout worked but the page on screen still showed an avatar until it was
  // reloaded, which reads as failure. Visible correctness is part of correctness.
  assert.equal(DEFAULT_SETTINGS.tabHandling, 'reload');
});

test('settings carry a version so behaviour changes can be migrated', () => {
  // A changed default never reaches an existing install on its own - the stored value
  // wins - so every behaviour change that matters needs a migration keyed on this.
  // Bumping the default without bumping this is how a change silently reaches nobody.
  assert.ok(DEFAULT_SETTINGS.version >= 4);
});

test('nothing automatic runs before the user has been onboarded', () => {
  // The whole point of the gate: a fresh install must not silently sign anyone out at
  // the first browser close, idle timeout, or screen lock.
  for (const trigger of ['browserClose', 'idle', 'lock']) {
    const plan = buildPlan(['chase.com', 'google.com'], /** @type {any} */ (trigger), DEFAULT_SETTINGS);
    assert.equal(plan.targets.length, 0, `${trigger} must not fire before onboarding`);
    assert.ok(plan.skipped.every((s) => s.why === 'setup not finished yet'));
  }

  // Explicit user actions still work immediately - the gate is about surprise, not
  // withholding the feature.
  assert.equal(buildPlan(['chase.com'], 'manual', DEFAULT_SETTINGS).targets.length, 1);
  assert.equal(buildPlan(['chase.com'], 'manualSite', DEFAULT_SETTINGS).targets.length, 1);
});

test('disabled trigger and paused extension produce no targets', () => {
  const off = withDefaults({ onboarded: true, onBrowserClose: { enabled: false, minTier: 'high' } });
  assert.equal(buildPlan(['chase.com'], 'browserClose', off).targets.length, 0);

  const paused = withDefaults({ onboarded: true, enabled: false });
  assert.equal(buildPlan(['chase.com'], 'manual', paused).targets.length, 0);
});

test('targets are ordered most dangerous first', () => {
  const plan = buildPlan(['netflix.com', 'chase.com', 'slack.com'], 'manual', READY);
  assert.deepEqual(plan.targets.map((t) => t.tier), ['critical', 'high', 'medium']);
});

test('low tier never gets a deep wipe by default', () => {
  const plan = buildPlan(['somerandomblog.net'], 'manual', READY);
  assert.deepEqual(plan.targets[0].dataTypes, ['cookies']);
});

test('every bundled recipe validates', () => {
  for (const recipe of RECIPES) {
    assert.ok(isValidRecipe(recipe), `${recipe.domain} failed validation`);
  }
  assert.ok(isValidRecipe(heuristicRecipe('https://example.com')));
});

test('no bundled recipe claims revoke-everywhere without verification', () => {
  // A GitHub recipe once reported revoking every session while the account's other devices
  // stayed signed in. A `global` claim now requires a `verified` date, set only after
  // someone watched a second device actually get signed out.
  for (const recipe of RECIPES) {
    if (recipe.capability === 'global') {
      assert.ok(recipe.verified, `${recipe.domain} claims global without verification`);
    }
  }
});

test('federated expansion is what makes a YouTube logout work at all', () => {
  // Observed end to end: logging out of youtube.com expanded to google.com, the Google
  // sign-out ran, and the browser's session disappeared from Google's device-activity
  // page. Without the expansion the YouTube clear would have been undone on next visit.
  const known = ['youtube.com', 'google.com'];
  const { domains } = expandForIdentity(['youtube.com'], known);
  assert.ok(domains.includes('google.com'));

  const plan = buildPlan(domains, 'manualSite', READY);
  const byDomain = Object.fromEntries(plan.targets.map((t) => [t.domain, t]));

  // Both must attempt a real sign-out. google.com is critical and always would have;
  // youtube.com is 'low' and only does so because an explicit click ignores the tier.
  assert.equal(byDomain['google.com'].serverLogout, true);
  assert.equal(byDomain['youtube.com'].serverLogout, true);
});

test('picking one site tries the real sign-out at any tier', () => {
  // Without a server-side logout a session is abandoned rather than ended: still live,
  // still listed, and no longer visible to the user. Worth a few seconds when the user
  // pointed at one site - youtube.com is 'low' tier and was orphaned every time.
  const low = buildPlan(['youtube.com'], 'manualSite', READY);
  assert.equal(low.targets[0].serverLogout, true);
});

test('bulk runs keep the tier threshold, or they would take half an hour', () => {
  // A real profile had 218 signed-in sites. At roughly ten seconds each, ignoring the
  // threshold here would lock the browser into something the user cannot interrupt.
  const all = buildPlan(['youtube.com', 'somerandomblog.net', 'chase.com'], 'manual', READY);
  const byDomain = Object.fromEntries(all.targets.map((t) => [t.domain, t]));

  assert.equal(byDomain['youtube.com'].serverLogout, false, 'low tier is skipped in bulk');
  assert.equal(byDomain['somerandomblog.net'].serverLogout, false);
  assert.equal(byDomain['chase.com'].serverLogout, true, 'critical still gets the real sign-out');

  const auto = buildPlan(['youtube.com'], 'browserClose', withDefaults({ onboarded: true, onBrowserClose: { enabled: true, minTier: 'low' } }));
  assert.equal(auto.targets[0].serverLogout, false, 'scheduled runs stay cheap');
});

test('a global recipe must contain a click that can fail it', () => {
  // Otherwise the recipe can complete having clicked nothing and still report success.
  for (const recipe of RECIPES) {
    if (recipe.capability !== 'global') continue;
    const decisive = recipe.steps.some(
      (s) => (s.op === 'click' || s.op === 'clickText') && !s.optional
    );
    assert.ok(decisive, `${recipe.domain} has no decisive click`);
  }

  assert.ok(
    !isValidRecipe({
      domain: 'example.com',
      capability: 'global',
      steps: [
        { op: 'navigate', url: 'https://example.com/x' },
        { op: 'clickText', selector: 'button', text: 'revoke', optional: true }
      ]
    }),
    'all-optional clicks must not validate as a global recipe'
  );
});

test('recipe validation rejects malformed input', () => {
  assert.ok(!isValidRecipe(null));
  assert.ok(!isValidRecipe({ domain: 'x.com', capability: 'global', steps: [] }));
  assert.ok(!isValidRecipe({ domain: 'x.com', capability: 'nope', steps: [{ op: 'sleep', ms: 1 }] }));
  assert.ok(!isValidRecipe({ domain: 'x.com', capability: 'global', steps: [{ op: 'exec', selector: 'a' }] }));
  assert.ok(
    !isValidRecipe({ domain: 'x.com', capability: 'global', steps: [{ op: 'navigate', url: 'http://insecure' }] }),
    'plaintext navigation must be rejected'
  );
});

test('recipe lookup is by registrable domain', () => {
  assert.ok(findRecipe('google.com'));
  assert.equal(findRecipe('unknown-site.example'), null);
});

test('recipes only ever drive the site own sign-out', () => {
  // The distinction that cost twelve recipes: submitting a site's sign-out form is a
  // concrete, checkable action, while clicking at a "revoke all devices" button nobody
  // has seen is a guess that fails silently. Clicking is allowed - but only on a page
  // reached through a logout URL, where the thing being clicked is the sign-out itself.
  for (const recipe of RECIPES) {
    assert.equal(recipe.capability, 'local', `${recipe.domain} claims more than it can show`);

    const clicks = recipe.steps.filter((s) => s.op === 'click' || s.op === 'clickText');
    if (clicks.length === 0) continue;

    const firstUrl = recipe.steps.find((s) => s.op === 'navigate')?.url ?? '';
    assert.match(
      firstUrl,
      /log-?out|sign-?out/i,
      `${recipe.domain} clicks on a page that is not a logout page`
    );
  }
});

test('the generic fallback tries the conventional logout path first', () => {
  // Deleting cookies abandons a session; using the site's own logout ends it. The /logout
  // convention is the cheapest way to reach a real sign-out form, and a form submit is
  // what carries the CSRF token the endpoint requires.
  const path = heuristicRecipe('https://example.com', 'path');
  assert.equal(path.steps[0].url, 'https://example.com/logout');
  assert.ok(
    path.steps.some((s) => s.op === 'clickText' && s.selector.includes('submit')),
    'a form submit is what actually signs you out'
  );
  assert.ok(isValidRecipe(path));

  const home = heuristicRecipe('https://example.com', 'home');
  assert.equal(home.steps[0].url, 'https://example.com');
  assert.ok(isValidRecipe(home));
});

test('sites without automation still point the user at their session list', () => {
  // The honest alternative to a recipe that pretends.
  assert.ok(sessionPageFor('github.com'), 'github has a session list worth linking to');
  assert.match(sessionPageFor('github.com').url, /^https:\/\/github\.com\//);
  assert.equal(sessionPageFor('somerandomblog.net'), null);
});

test('the compromise route is offered before logout, not after', () => {
  // If someone else holds a live session, logging yourself out is the wrong first move:
  // it surrenders the one authenticated session you control and leaves theirs running.
  // Changing the password from the session you already have ends every other session and
  // keeps you signed in - which is only possible if you have not just logged out.
  const advice = compromiseAdviceFor('github.com');
  assert.equal(advice.domain, 'github.com');
  assert.match(advice.title, /^GitHub cannot sign out your other devices$/);
  assert.match(advice.explanation, /no "sign out everywhere"/);
  assert.match(advice.explanation, /verify your identity by email/);
  assert.match(advice.advice, /change your password instead/);
  assert.match(advice.advice, /leaves this window signed in/);
  assert.equal(advice.passwordUrl, 'https://github.com/settings/security');
  assert.equal(advice.sessionsUrl, 'https://github.com/settings/sessions');
});

test('sites are named properly, not naively capitalised', () => {
  // "Github" and "Linkedin" read as carelessness in a tool asking to be trusted.
  assert.match(compromiseAdviceFor('linkedin.com').title, /^LinkedIn/);
  assert.match(compromiseAdviceFor('icloud.com').title, /^iCloud/);
  assert.match(compromiseAdviceFor('paypal.com').title, /^PayPal/);
});

test('every site gets the warning, with honest degradation', () => {
  // No site can currently have its other sessions ended by this extension, so every site
  // deserves the same warning. What degrades is the specificity, never the honesty.
  const known = compromiseAdviceFor('github.com');
  assert.ok(known.passwordUrl, 'a direct link where one is known');

  const unknown = compromiseAdviceFor('somerandomblog.net');
  assert.ok(unknown, 'an unknown site still gets the warning');
  assert.equal(unknown.passwordUrl, undefined, 'no password URL is invented');
  assert.equal(unknown.siteUrl, 'https://somerandomblog.net', 'the site itself is the fallback');
  assert.match(unknown.advice, /account settings/);
  assert.match(unknown.advice, /leaves this window signed in/);
});

test('the warning disappears once a site can actually revoke globally', () => {
  // Nothing qualifies today. The check exists so the advice stops the moment one does,
  // rather than nagging about a problem that has been solved.
  assert.equal(compromiseAdviceFor('github.com', true), null);
});

test('the warning defaults to every site', () => {
  // No site can currently have its other sessions ended by this extension, so the warning
  // applies everywhere. Click-through fatigue is a real cost, but a smaller one than
  // silently logging someone out of a compromised account without ever mentioning the
  // action that would have helped.
  assert.equal(DEFAULT_SETTINGS.compromisePrompt, 'always');
  assert.equal(DEFAULT_SETTINGS.version, 4, 'needs a migration to reach existing installs');
});

test('a site with no bulk revoke says so, and names the alternative', () => {
  // GitHub, confirmed: sessions are revoked one at a time and there is no "sign out
  // everywhere". Telling the user that a password change is the bulk option is the only
  // useful thing left to say.
  const github = revokeGuidanceFor('github.com');
  assert.equal(github.kind, 'individual');
  assert.match(github.message, /one at a time/);
  assert.match(github.message, /password/);
  assert.equal(github.url, 'https://github.com/settings/sessions');
});

test('a session ended through the site reads differently from one abandoned', () => {
  // Clearing cookies leaves a live token on the server that the user can no longer see.
  // Using the site's own sign-out ends it. Those are materially different outcomes and
  // the wording has to separate them.
  const ended = revokeGuidanceFor('github.com', true);
  assert.match(ended.message, /signed out properly, not just cleared/);
  assert.match(ended.message, /other devices/);

  const abandoned = revokeGuidanceFor('github.com', false);
  assert.notEqual(ended.message, abandoned.message);
  assert.match(abandoned.message, /one at a time/);
});

test('a site with a known page but unchecked capability is not overclaimed', () => {
  const dropbox = revokeGuidanceFor('dropbox.com');
  assert.equal(dropbox.kind, 'page');
  assert.match(dropbox.message, /if it offers it/);
  assert.ok(dropbox.url);
});

test('a site with no known session page falls back to changing the password', () => {
  const unknown = revokeGuidanceFor('somerandomblog.net');
  assert.equal(unknown.kind, 'passwordOnly');
  assert.match(unknown.message, /changing your password/);
  assert.equal(unknown.url, undefined);
  // Hedged deliberately: absence from a 23-entry list is not proof the site has nothing.
  assert.match(unknown.message, /Check its account security settings/);
});
