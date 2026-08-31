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
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function pageStep(step) {
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
      // Outside the viewport we cannot hit-test; scrolling has already been attempted,
      // so give the element the benefit of the doubt rather than skipping it.
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    } catch {
      return true;
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

  try {
    switch (step.op) {
      case 'sleep': {
        await wait(Math.min(step.ms || 0, 10000));
        return { ok: true, detail: 'waited' };
      }

      case 'waitFor': {
        const deadline = Date.now() + (step.timeoutMs || 8000);
        while (Date.now() < deadline) {
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
          candidate.scrollIntoView({ block: 'center' });
          if (!hittable(candidate)) continue;
          candidate.click();
          return { ok: true, detail: `clicked "${labelOf(candidate).slice(0, 60)}"` };
        }

        return { ok: false, detail: `found ${candidates.length} match(es) but all were obscured` };
      }

      default:
        return { ok: false, detail: `unsupported op ${step.op}` };
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
