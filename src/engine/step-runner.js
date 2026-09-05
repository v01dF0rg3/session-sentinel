/**
 * The one function that runs inside a page.
 *
 * It is injected with chrome.scripting.executeScript({ func }), which serialises it by
 * toString(), so it must be completely self-contained: no imports, no closure over
 * module scope, no helpers from outside its own body.
 *
 * It executes exactly ONE step and returns. The loop lives in the service worker,
 * because any step can trigger a navigation that destroys this execution context
 * mid-flight - a loop running in the page would simply vanish at that point.
 */

/**
 * @param {import('../core/recipes.js').Step} step
 * @param {string} expectedOrigin Worker-checked origin, checked again inside this document.
 * @param {number} expiresAt Absolute worker deadline; queued or throttled work may not act late.
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function pageStep(step, expectedOrigin, expiresAt) {
  const onExpectedOrigin = () => typeof expectedOrigin === 'string' &&
    expectedOrigin !== 'null' && location.origin === expectedOrigin;
  if (!onExpectedOrigin()) return { ok: false, detail: 'page origin changed or was not authorized' };
  const expired = () => !Number.isFinite(expiresAt) || Date.now() >= expiresAt;
  if (expired()) return { ok: false, detail: 'page action expired or had no deadline' };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Case-insensitive match against a pipe-separated list of literal phrases.
   * Deliberately not a RegExp built from data - keeping recipe fields inert makes the
   * "recipes are data, never code" claim true at every level.
   */
  const matchesText = (haystack, phrases) => {
    const text = (haystack || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return phrases
      .split('|')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
      .some((phrase) => text.includes(phrase));
  };

  /**
   * Is this element really on screen for a user to click?
   *
   * Naively checking for a 0x0 box is not enough, and getting it wrong is dangerous:
   * a hidden decoy that accepts a click makes the runner report success while the real
   * control is untouched. Sites hide accessible duplicates of their controls all the
   * time with sr-only patterns - `width:0;height:0;overflow:hidden`, clip rects,
   * `left:-9999px` - and padding gives those a non-zero border box.
   */
  const visible = (el) => {
    try {
      if (el.closest('[aria-hidden="true"]')) return false;
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;

      if (typeof el.checkVisibility === 'function') {
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      }

      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;

      if (style.clip === 'rect(0px, 0px, 0px, 0px)') return false;
      if (style.clipPath === 'inset(50%)') return false;

      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return false;
      // Parked off the top-left of the document, the other common hiding trick.
      if (rect.right <= 0 || rect.bottom <= 0) return false;

      return true;
    } catch {
      return false;
    }
  };

  /**
   * Hit-test the centre of an element. Catches the case a visibility check cannot: a
   * perfectly visible button sitting underneath a cookie banner or modal overlay, where
   * .click() fires on the wrong thing or does nothing at all.
   */
  const hittable = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      // Outside the viewport we cannot hit-test. Scrolling has already been attempted;
      // an untestable control must not receive the benefit of the doubt.
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    } catch {
      return false;
    }
  };

  /** Prefer the visible label, but fall back to whatever named the control. */
  const labelOf = (el) =>
    [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('value')]
      .map((part) => (part || '').trim())
      .filter(Boolean)
      .join(' ');

  const findAll = (selector) => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  // Do not let a trusted page's link/form send an automated click to another account
  // origin. JS handlers cannot be proven safe by DOM inspection; that remains a limit.
  const destinationAllowed = (el) => {
    const link = el.closest('a[href]');
    const form = el.form;
    const targets = [];
    if (link) targets.push(link.href);
    if (form) targets.push(el.hasAttribute('formaction') ? el.formAction : form.action);
    return targets.every((value) => {
      try { const url = new URL(value, location.href); return url.origin === expectedOrigin && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
      catch { return false; }
    });
  };

  try {
    switch (step.op) {
      case 'sleep': {
        // Kept for the isolated page harness; production recipes sleep in the worker.
        await wait(Math.min(step.ms || 0, 10000, Math.max(0, expiresAt - Date.now())));
        return expired() ? { ok: false, detail: 'page action expired' } : { ok: true, detail: 'waited' };
      }

      case 'waitFor': {
        const deadline = Math.min(expiresAt, Date.now() + (step.timeoutMs || 8000));
        while (Date.now() < deadline) {
          if (!onExpectedOrigin()) return { ok: false, detail: 'page origin changed' };
          if (findAll(step.selector || '').some(visible)) return { ok: true, detail: 'found' };
          await wait(150);
        }
        return { ok: false, detail: 'selector never appeared' };
      }

      case 'assertPresent': {
        const present = findAll(step.selector || '').some(visible);
        return { ok: present, detail: present ? 'present' : 'not present' };
      }

      case 'assertAbsent': {
        const present = findAll(step.selector || '').some(visible);
        return { ok: !present, detail: present ? 'still present' : 'absent' };
      }

      case 'click':
      case 'clickText': {
        let candidates = findAll(step.selector || '').filter(visible);

        if (step.op === 'clickText') {
          candidates = candidates.filter((el) => {
            const label = labelOf(el);
            // Skip anything with a huge subtree: matching a whole page container and
            // clicking it does nothing useful and can fire the wrong handler.
            if (label.length > 400) return false;
            return matchesText(label, step.text || '');
          });
        }

        if (candidates.length === 0) {
          return { ok: false, detail: step.op === 'click' ? 'nothing to click' : 'no matching control' };
        }

        // Prefer the innermost match: if one candidate wraps another, the inner one is
        // the actual control and the outer is a layout container.
        const innermost = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
        if (innermost.length > 0) candidates = innermost;

        // Then prefer the largest. Sites routinely ship an accessible duplicate of a
        // control collapsed to a few pixels with `width:0;overflow:hidden`; padding
        // gives it a non-zero box, so no CSS check reliably rules it out - but it is
        // always far smaller than the control a person actually sees and clicks.
        const area = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width * rect.height;
        };
        candidates.sort((a, b) => area(b) - area(a));

        // Scroll each candidate into view before hit-testing it, and move on if
        // something is covering it. Reporting a click that landed on an overlay as
        // success is how a logout silently does not happen.
        for (const candidate of candidates) {
          if (expired()) return { ok: false, detail: 'page action expired' };
          if (!onExpectedOrigin()) return { ok: false, detail: 'page origin changed' };
          if (!destinationAllowed(candidate)) continue;
          candidate.scrollIntoView({ block: 'center' });
          if (!hittable(candidate)) continue;
          if (expired()) return { ok: false, detail: 'page action expired' };
          if (!onExpectedOrigin() || !destinationAllowed(candidate)) continue;
          candidate.click();
          return { ok: true, detail: 'activated a matching control' };
        }

        return { ok: false, detail: `found ${candidates.length} match(es) but all were obscured or had an untrusted destination` };
      }

      default:
        return { ok: false, detail: `unsupported op ${step.op}` };
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
