/**
 * Recipe bundle signing tool. Development only — never shipped in the extension.
 *
 *   node dev/sign-bundle.mjs keygen
 *   node dev/sign-bundle.mjs sign <payload.json> <out.json>
 *
 * The private key lives outside the repository, under ~/.session-sentinel/keys by
 * default. Losing it means minting a new key and shipping an extension update to change
 * the pinned one, so back it up somewhere that is neither this repository nor this disk.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Keys live OUTSIDE the repository, not merely gitignored inside it.
 *
 * A .gitignore entry is one `git add -f`, one careless edit, or one `git clean` away from
 * failing, and this repository is public. The key that signs recipe bundles is the whole
 * trust anchor of the update channel: anyone holding it can serve a signed bundle that
 * every installation will accept. Distance from the repo is worth more than a rule inside
 * it.
 *
 * Override with SENTINEL_KEY_DIR to point somewhere else entirely - a removable drive, or
 * a password manager's file store.
 */
const KEY_DIR = process.env.SENTINEL_KEY_DIR ?? join(homedir(), '.session-sentinel', 'keys');
const PRIVATE_KEY_PATH = join(KEY_DIR, 'private.jwk.json');
const PUBLIC_KEY_PATH = join(KEY_DIR, 'public.spki.txt');

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' };

/** @param {ArrayBuffer} buffer */
const toBase64 = (buffer) => Buffer.from(buffer).toString('base64');

async function keygen() {
  if (existsSync(PRIVATE_KEY_PATH)) {
    console.error(`Refusing to overwrite ${PRIVATE_KEY_PATH}. Delete it first if you really mean to.`);
    process.exit(1);
  }
  await mkdir(KEY_DIR, { recursive: true });

  const pair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const spkiBase64 = toBase64(spki);

  await writeFile(PRIVATE_KEY_PATH, JSON.stringify(jwk, null, 2));
  await writeFile(PUBLIC_KEY_PATH, spkiBase64 + '\n');

  console.log(`private key -> ${PRIVATE_KEY_PATH}  (gitignored, back this up)`);
  console.log(`public key  -> ${PUBLIC_KEY_PATH}`);
  console.log('\nPin this in src/platform/recipe-store.js as BUNDLE_PUBLIC_KEY:\n');
  console.log(spkiBase64);
}

/**
 * @param {string} payloadPath
 * @param {string} outPath
 */
async function sign(payloadPath, outPath) {
  const jwk = JSON.parse(await readFile(PRIVATE_KEY_PATH, 'utf8'));
  const key = await crypto.subtle.importKey('jwk', jwk, ALGO, false, ['sign']);

  // Re-serialise once here, then sign THAT exact string and ship it verbatim. The
  // verifier checks the bytes it was given and parses the same bytes, so there is no
  // canonicalisation step where signed and parsed content could diverge.
  const payload = JSON.stringify(JSON.parse(await readFile(payloadPath, 'utf8')));

  const signature = await crypto.subtle.sign(SIGN_PARAMS, key, new TextEncoder().encode(payload));
  const envelope = { payload, signature: toBase64(signature) };

  await writeFile(outPath, JSON.stringify(envelope, null, 2) + '\n');

  const parsed = JSON.parse(payload);
  console.log(`signed version ${parsed.version} with ${parsed.recipes?.length ?? 0} recipes -> ${outPath}`);
}

const [command, ...args] = process.argv.slice(2);

if (command === 'keygen') {
  await keygen();
} else if (command === 'sign' && args.length === 2) {
  await sign(args[0], args[1]);
} else {
  console.error('usage:\n  node dev/sign-bundle.mjs keygen\n  node dev/sign-bundle.mjs sign <payload.json> <out.json>');
  process.exit(1);
}
