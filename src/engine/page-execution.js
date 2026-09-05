import { pageStep } from './step-runner.js';

/**
 * A page-controlled promise must not hold the worker's cleanup sequence indefinitely.
 * The caller owns the temporary tab and must close it in finally, including on timeout.
 * Timing out cannot cancel executeScript, so the injected code also rejects expired work.
 */
export async function executePageStep(tabId, step, expectedOrigin, deadline) {
  const startedAt = Date.now();
  const expiresAt = Math.min(deadline, startedAt + (step.timeoutMs ?? 8000));
  const budget = expiresAt - startedAt;
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('page step timed out before execution');
  if (step.op === 'sleep') throw new Error('sleep steps must run in the worker, not the page');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => chrome.scripting.executeScript({
        target: { tabId },
        injectImmediately: true,
        func: pageStep,
        args: [{ ...step, timeoutMs: budget }, expectedOrigin, expiresAt]
      })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`page step "${step.op}" timed out; the temporary tab will be closed`)), budget);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
