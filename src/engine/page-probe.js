/**
 * Counting sign-in and sign-out affordances on a page.
 *
 * This function is serialised with `toString()` and injected into the page, so it must be
 * entirely self-contained: no imports, no closure over anything. The patterns below are
 * therefore duplicated from core/page-signals.js, where the same intent is pinned by tests
 * that can run without a browser.
 *
 * It counts and returns numbers. It does not decide anything, does not read text content
 * beyond matching these patterns, and never returns page content — the judgement happens
 * in core, and nothing about the page leaves the page.
 */

/**
 * @returns {import('../core/page-signals.js').PageEvidence}
 */
export function collectPageEvidence() {
  const LOGOUT_TEXT = /^\s*(sign|log)\s*-?\s*(out|off)\b/i;
  const SIGNIN_TEXT = /^\s*(sign|log)\s*-?\s*in\b|^\s*login\s*$|^\s*create account\s*$|^\s*sign up\s*$/i;
  const LOGOUT_HREF = /\/(logout|signout|sign-out|sign_out|log-out|log_out)(\/|\?|#|$)/i;
  const ACCOUNT_MARKER = /(account.?switch|switch.?account|account.?menu|user.?menu|profile.?menu|avatar.?menu)/i;

  /** @param {Element} el */
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  let logoutControls = 0;
  let logoutHrefs = 0;
  let signInControls = 0;

  const clickable = document.querySelectorAll('a, button, [role="button"], [role="menuitem"]');
  for (const el of clickable) {
    // Own text only. An ancestor containing a sign-out link would otherwise match on every
    // wrapper up the tree and inflate the count, and a whole-page match would fire on any
    // article that happens to discuss signing out.
    const own = /** @type {HTMLElement} */ (el).innerText ?? el.textContent ?? '';
    const text = own.length > 40 ? '' : own;

    const href = el.getAttribute('href') ?? '';
    if (href && LOGOUT_HREF.test(href)) {
      // Counted whether or not it is visible: many sites render the account menu upfront
      // and hide it with CSS, and requiring visibility would miss them for no gain.
      logoutHrefs += 1;
      continue;
    }

    if (!text) continue;
    if (LOGOUT_TEXT.test(text)) {
      if (visible(el)) logoutControls += 1;
      continue;
    }
    if (SIGNIN_TEXT.test(text) && visible(el)) signInControls += 1;
  }

  const passwordFields = document.querySelectorAll('input[type="password"]').length;

  // The control that OPENS an account menu, for apps that build the menu's contents only
  // once it is clicked. Sites name these themselves, in test ids and ARIA labels.
  let accountMarkers = 0;
  for (const el of document.querySelectorAll('[data-testid], [aria-label]')) {
    const name = el.getAttribute('data-testid') || el.getAttribute('aria-label') || '';
    if (name && ACCOUNT_MARKER.test(name)) accountMarkers += 1;
  }

  return { logoutControls, logoutHrefs, signInControls, passwordFields, accountMarkers };
}
