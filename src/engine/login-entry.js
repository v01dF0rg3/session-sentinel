/**
 * Activate a site's own login control.
 *
 * This function is serialised with `toString()` and injected into the page, so it must be
 * entirely self-contained. It runs only after the user clicks Login on that exact domain.
 * The page chooses its own destination; the extension neither invents an identity provider
 * nor returns page text or URLs to the service worker.
 *
 * @returns {{ activated: boolean, kind?: 'link' | 'button' }}
 */
export function activateLoginControl() {
  const LOGIN_TEXT = /^\s*(sign|log)\s*-?\s*in\b|^\s*login\s*$/i;
  const LOGIN_HREF = /\/(login|signin|sign-in|sign_in|log-in|log_in)(\/|\?|#|$)/i;

  /** @param {Element} element */
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  const matches = [];
  for (const element of document.querySelectorAll('a, button, [role="button"], [role="link"]')) {
    if (!visible(element)) continue;

    const label =
      element.getAttribute('aria-label') || element.innerText || element.textContent || '';
    const text = label.length <= 80 ? label : '';
    const href = element.getAttribute('href') || '';
    const textMatch = LOGIN_TEXT.test(text);
    // An href is enough only when the control has no readable label. Otherwise prose such
    // as "How to sign in" linking to /help/sign-in would be mistaken for the real control.
    const hrefMatch = !text.trim() && LOGIN_HREF.test(href);
    if (!textMatch && !hrefMatch) continue;

    // A control that calls itself "Sign in" outranks an unlabeled /login link.
    matches.push({ element, href, score: textMatch ? 0 : 1 });
  }

  matches.sort((a, b) => a.score - b.score);
  const chosen = matches[0];
  if (!chosen) return { activated: false };

  // Preserve the site's click handler: it may create OAuth state or open a login modal.
  // Keep ordinary links in this tab so the tab-specific intent follows the login.
  if (chosen.href && chosen.element.getAttribute('target') === '_blank') {
    chosen.element.setAttribute('target', '_self');
  }
  chosen.element.click();
  return { activated: true, kind: chosen.href ? 'link' : 'button' };
}
