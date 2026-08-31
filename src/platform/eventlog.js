/**
 * A persistent, append-only event log.
 *
 * The single-breadcrumb approach had a flaw that only showed up in practice: it was
 * cleared when a run finished, and the runs that killed the browser were *finishing*
 * first. The evidence erased itself.
 *
 * This log is never cleared automatically. It records the start and end of every run,
 * each step within it, and browser lifecycle events - so the question "did the browser
 * die during step X, or after the run had already completed?" has an answer sitting in
 * storage after the fact.
 *
 * Capped at 200 entries, in `chrome.storage.local` so it survives the browser dying.
 */

const KEY = 'eventLog';
const MAX_ENTRIES = 200;

/**
 * @typedef {object} LogEntry
 * @property {number} t
 * @property {string} type
 * @property {string} detail
 */

/**
 * @param {string} type
 * @param {string} [detail]
 */
export async function logEvent(type, detail = '') {
  try {
    const stored = await chrome.storage.local.get(KEY);
    const entries = Array.isArray(stored[KEY]) ? stored[KEY] : [];
    entries.push({ t: Date.now(), type, detail });
    await chrome.storage.local.set({ [KEY]: entries.slice(-MAX_ENTRIES) });
  } catch {
    // Logging must never be the thing that breaks a run.
  }
}

/** @returns {Promise<LogEntry[]>} */
export async function readLog() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return Array.isArray(stored[KEY]) ? stored[KEY] : [];
  } catch {
    return [];
  }
}

export async function clearLog() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Render the log as plain text for pasting into a bug report.
 * @param {LogEntry[]} entries
 * @returns {string}
 */
export function formatLog(entries) {
  return entries
    .map((e) => `${new Date(e.t).toISOString()}  ${e.type}${e.detail ? '  ' + e.detail : ''}`)
    .join('\n');
}
