/**
 * Security copy is part of the product contract.
 *
 * A logout click, a password change, and local cookie deletion are all useful, but none is
 * universal proof that a copied token stopped working. Keep the strongest user-facing
 * promises pinned so an innocent wording edit cannot reintroduce that claim.
 */

import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const USER_FACING_FILES = [
  '../README.md',
  '../PRIVACY.md',
  '../manifest.json',
  '../STORE.md',
  '../src/ui/popup.html',
  '../src/ui/popup.js',
  '../src/ui/signout-prompt.js',
  '../src/ui/popup-view.js',
  '../src/ui/options.html',
  '../src/ui/recovery.html',
  '../src/ui/recovery.js',
  '../src/ui/recovery-plan.js',
  '../src/core/recovery-handoff.js',
  '../data/recovery-checklist.js',
  '../src/ui/welcome.html',
  '../src/ui/options.js',
  // Diagnostics and the written docs describe what the extension proves, so they can
  // reintroduce a retired promise exactly as easily as the popup can.
  '../src/ui/diagnostics.html',
  '../src/ui/diagnostics.js',
  '../ARCHITECTURE.md',
  '../TESTING.md',
  '../SECURITY.md',
  '../src/core/session-pages.js'
];

const FORBIDDEN_PROMISES = [
  /ends every other session/i,
  /ends all other sessions/i,
  /kills every other session/i,
  /immediately,\s*everywhere/i,
  /signed out properly/i,
  /session really ends/i,
  /sessions are gone by the time/i,
  /password change is (?:the )?(?:reliable|universal)/i
];

async function userFacingCopy() {
  const sources = await Promise.all(
    USER_FACING_FILES.map(async (path) => ({
      path,
      text: await readFile(new URL(path, import.meta.url), 'utf8')
    }))
  );
  return sources;
}

test('user-facing copy makes no universal session-revocation promise', async () => {
  for (const { path, text } of await userFacingCopy()) {
    for (const pattern of FORBIDDEN_PROMISES) {
      assert.doesNotMatch(text, pattern, `${path} must not promise ${pattern}`);
    }
  }
});

test('recovery and results state the safety limits explicitly', async () => {
  const recovery = await readFile(new URL('../src/ui/recovery.html', import.meta.url), 'utf8');
  const popup = await readFile(new URL('../src/ui/popup.html', import.meta.url), 'utf8');
  const report = await readFile(new URL('../src/engine/report.js', import.meta.url), 'utf8');

  assert.match(recovery, /trusted (?:phone|computer|device)/i);
  assert.match(recovery, /password change does not guarantee every session/i);
  assert.match(popup, /Sign out of all confirmed accounts/);
  assert.match(popup, /Tries site sign-out, then clears local session data\./);
  assert.match(popup, /Other sessions or stolen tokens may still work\./);
  assert.match(report, /invalidation of a copied token was not independently proved/i);
});
