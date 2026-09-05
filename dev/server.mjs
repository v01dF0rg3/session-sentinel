// Minimal static server for the dev harness. Not part of the extension.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || 5599);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

/**
 * UI previews are GENERATED from the real pages, never copied.
 *
 * They used to be hand-maintained duplicates, and they drifted three times. The last drift
 * was the worst kind: the preview still showed "Log out of all sessions" and a heading
 * reading "Signed in" weeks after the real popup had been corrected to "Attempt sign-out of
 * confirmed accounts" and "Confirmed accounts". A preview that shows retired copy is worse
 * than no preview, because reviewing wording against it produces confident wrong answers.
 *
 * The only differences a preview ever needed were mechanical: inject the chrome stub, and
 * point the relative asset paths back at src/ui. Doing that on the fly makes drift
 * impossible rather than merely unlikely.
 *
 * @param {string} name
 * @returns {Promise<string>}
 */
async function renderPreview(name) {
  const html = await readFile(join(ROOT, 'src', 'ui', `${name}.html`), 'utf8');
  // Rewrite the page's own asset paths FIRST, then inject the stub. Injecting first meant
  // the rewrite caught the stub's own src and pointed it at src/ui, so the stub 404'd and
  // every preview rendered its static markup with no chrome.* behind it - which looks
  // almost right, and is the most misleading way for this to fail.
  const rebased = html.replace(
    /(?:href|src)="(?!https?:|\/|\.\.\/)([^"]+)"/g,
    (match, asset) => match.replace(`"${asset}"`, `"../src/ui/${asset}"`)
  );

  return rebased.replace('<head>', '<head><script src="chrome-stub.js"></script>');
}

const PREVIEW = /^\/dev\/([a-z-]+)-preview\.html$/;

createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method) || ![`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(req.headers.host)) {
    res.writeHead(403); return res.end('forbidden');
  }
  let path;
  try { path = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); return res.end('invalid path'); }
  // Never expose .git, local config, or files outside the preview asset directories.
  if (/[\\\x00]/.test(path) || path.split('/').some((part) => part.startsWith('.')) ||
      !/^\/(?:dev\/|src\/|data\/|icons\/|manifest\.json$|package\.json$)/.test(path)) {
    res.writeHead(404); return res.end('not found');
  }

  const preview = PREVIEW.exec(path);
  if (preview) {
    try {
      const body = await renderPreview(preview[1]);
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      return res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end(`no src/ui/${preview[1]}.html to preview`);
    }
  }

  const target = resolve(ROOT, `.${path}`);
  const inside = relative(ROOT, target);
  if (inside.startsWith('..') || isAbsolute(inside)) { res.writeHead(404); return res.end('not found'); }
  try {
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`dev harness on http://localhost:${PORT} (loopback only)`));
