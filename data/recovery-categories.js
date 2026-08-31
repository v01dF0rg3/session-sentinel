/**
 * Blast-radius categories, used to order a breach recovery.
 *
 * Risk tier answers "how bad is losing this account". Recovery order answers a different
 * question: "which account, if I secure it second, was used to retake the first". Those
 * are not the same, and the difference decides whether a recovery works.
 *
 * Email and identity providers come first regardless of how the tier ranks them, because
 * they are the reset vector for everything else. Securing a bank before the mailbox that
 * receives its password-reset link is wasted work — the attacker simply resets it again.
 *
 * Categorising is far safer to guess at than a CSS selector: a site in the wrong bucket
 * is handled slightly out of order, not handled wrongly.
 */

/** @typedef {'identity' | 'finance' | 'infrastructure' | 'communication' | 'other'} RecoveryCategory */

/**
 * The order the categories are worked through. Lower is sooner.
 * @type {Record<RecoveryCategory, number>}
 */
export const CATEGORY_ORDER = {
  identity: 0,
  finance: 1,
  infrastructure: 2,
  communication: 3,
  other: 4
};

/** @type {Record<RecoveryCategory, string>} */
export const CATEGORY_LABELS = {
  identity: 'Email and identity',
  finance: 'Money',
  infrastructure: 'Infrastructure and code',
  communication: 'Communication and social',
  other: 'Everything else'
};

/** @type {Record<RecoveryCategory, string>} */
export const CATEGORY_WHY = {
  identity:
    'Secure these first. Every other account can be reset through them, so anything you fix before these can simply be taken again.',
  finance: 'Direct loss. Stored cards, transfers, and anything that can move money.',
  infrastructure:
    'Lasting damage. Code, deployments, domains and cloud accounts can be altered in ways that outlive the breach.',
  communication:
    'Impersonation, and a reset vector of their own for anything tied to these accounts.',
  other: 'Lower stakes, but still worth changing once the rest is done.'
};

/** @type {Record<string, RecoveryCategory>} */
export const DOMAIN_CATEGORY = {
  // Identity: mailboxes, password managers, single sign-on.
  'google.com': 'identity', 'gmail.com': 'identity', 'googlemail.com': 'identity',
  'outlook.com': 'identity', 'live.com': 'identity', 'microsoft.com': 'identity',
  'office.com': 'identity', 'microsoftonline.com': 'identity',
  'yahoo.com': 'identity', 'aol.com': 'identity', 'gmx.com': 'identity',
  'proton.me': 'identity', 'protonmail.com': 'identity', 'fastmail.com': 'identity',
  'zoho.com': 'identity', 'icloud.com': 'identity', 'apple.com': 'identity',
  'okta.com': 'identity', 'auth0.com': 'identity', 'onelogin.com': 'identity',
  'duosecurity.com': 'identity', 'id.me': 'identity', 'login.gov': 'identity',
  'lastpass.com': 'identity', '1password.com': 'identity', 'bitwarden.com': 'identity',
  'dashlane.com': 'identity', 'keepersecurity.com': 'identity',

  // Finance.
  'chase.com': 'finance', 'bankofamerica.com': 'finance', 'wellsfargo.com': 'finance',
  'citi.com': 'finance', 'citibank.com': 'finance', 'usbank.com': 'finance',
  'capitalone.com': 'finance', 'discover.com': 'finance', 'americanexpress.com': 'finance',
  'ally.com': 'finance', 'schwab.com': 'finance', 'fidelity.com': 'finance',
  'vanguard.com': 'finance', 'etrade.com': 'finance', 'robinhood.com': 'finance',
  'paypal.com': 'finance', 'venmo.com': 'finance', 'wise.com': 'finance',
  'stripe.com': 'finance', 'squareup.com': 'finance', 'cash.app': 'finance',
  'revolut.com': 'finance', 'monzo.com': 'finance', 'coinbase.com': 'finance',
  'binance.com': 'finance', 'kraken.com': 'finance', 'gemini.com': 'finance',
  'blockchain.com': 'finance', 'intuit.com': 'finance', 'breadpayments.com': 'finance',

  // Infrastructure.
  'github.com': 'infrastructure', 'gitlab.com': 'infrastructure', 'bitbucket.org': 'infrastructure',
  'amazonaws.com': 'infrastructure', 'azure.com': 'infrastructure', 'cloud.google.com': 'infrastructure',
  'digitalocean.com': 'infrastructure', 'cloudflare.com': 'infrastructure', 'linode.com': 'infrastructure',
  'vercel.com': 'infrastructure', 'netlify.com': 'infrastructure', 'heroku.com': 'infrastructure',
  'namecheap.com': 'infrastructure', 'godaddy.com': 'infrastructure', 'porkbun.com': 'infrastructure',
  'npmjs.com': 'infrastructure', 'pypi.org': 'infrastructure', 'docker.com': 'infrastructure',

  // Communication and social.
  'facebook.com': 'communication', 'instagram.com': 'communication', 'x.com': 'communication',
  'twitter.com': 'communication', 'linkedin.com': 'communication', 'discord.com': 'communication',
  'slack.com': 'communication', 'telegram.org': 'communication', 'whatsapp.com': 'communication',
  'snapchat.com': 'communication', 'tiktok.com': 'communication', 'reddit.com': 'communication',
  'messenger.com': 'communication', 'zoom.us': 'communication'
};

/**
 * Applied to anything not listed, in order. Identity patterns come first for the same
 * reason identity comes first overall.
 * @type {Array<[RegExp, RecoveryCategory]>}
 */
export const CATEGORY_KEYWORDS = [
  [/(mail|inbox|webmail|passport|account|identity|sso|auth|login)/i, 'identity'],
  [/(bank|banking|creditunion|savings|mortgage|lending|pay|wallet|invoice|billing|payroll|tax|crypto|coin|exchange|trading|broker|insurance)/i, 'finance'],
  [/(cloud|server|hosting|domain|registrar|dns|admin|console|dashboard|deploy|git|repo|ci)/i, 'infrastructure'],
  [/(social|chat|messenger|forum|community|connect)/i, 'communication']
];
