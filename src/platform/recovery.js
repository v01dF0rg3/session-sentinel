/**
 * Recovery progress, persisted.
 *
 * Working through fourteen accounts takes long enough that the browser will be closed,
 * restarted, or crash partway. Losing your place means starting again, and a recovery
 * people abandon halfway is one that leaves the tail end permanently unsecured — so this
 * lives in `chrome.storage.local`, which survives all of that.
 */

const KEY = 'recoveryState';

/**
 * @typedef {object} RecoveryState
 * @property {number} startedAt
 * @property {string[]} done Domains the user has marked as reviewed; not proof of revocation.
 * @property {import('../core/risk.js').RiskTier} minTier
 */

/** @type {RecoveryState} */
const EMPTY = { startedAt: 0, done: [], minTier: 'high' };

/** @returns {Promise<RecoveryState>} */
export async function getRecoveryState() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return { ...EMPTY, ...(stored[KEY] ?? {}) };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * @param {Partial<RecoveryState>} patch
 * @returns {Promise<RecoveryState>}
 */
export async function updateRecoveryState(patch) {
  const next = { ...(await getRecoveryState()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/**
 * @param {string} domain
 * @param {boolean} done
 * @returns {Promise<RecoveryState>}
 */
export async function markRecoveryStep(domain, done) {
  const state = await getRecoveryState();
  const set = new Set(state.done);
  if (done) set.add(domain);
  else set.delete(domain);
  return updateRecoveryState({
    done: [...set],
    startedAt: state.startedAt || Date.now()
  });
}

/** Start over. Keeps nothing: a stale half-finished plan is worse than none. */
export async function clearRecoveryState() {
  await chrome.storage.local.remove(KEY);
}
