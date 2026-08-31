/**
 * Bundled risk classification. Inert data, never executable, so it stays shippable
 * under the Web Store remote-code rules when this later moves to a downloaded bundle.
 *
 * This is a seed list, not a complete one. classify() falls back to keyword and TLD
 * scoring for everything absent here, so an unlisted bank still lands in a sane tier.
 */

/** @type {Record<string, import('../src/core/risk.js').RiskTier>} */
export const DOMAIN_RISK = {
  // --- Email: the master key to every other account -------------------------
  'google.com': 'critical', 'gmail.com': 'critical', 'outlook.com': 'critical',
  'live.com': 'critical', 'office.com': 'critical', 'microsoft.com': 'critical',
  'yahoo.com': 'critical', 'proton.me': 'critical', 'protonmail.com': 'critical',
  'zoho.com': 'critical', 'fastmail.com': 'critical', 'icloud.com': 'critical',
  'apple.com': 'critical', 'aol.com': 'critical', 'gmx.com': 'critical',

  // --- Identity providers and password managers -----------------------------
  'okta.com': 'critical', 'auth0.com': 'critical', 'onelogin.com': 'critical',
  'duosecurity.com': 'critical', 'lastpass.com': 'critical', '1password.com': 'critical',
  'bitwarden.com': 'critical', 'dashlane.com': 'critical', 'keepersecurity.com': 'critical',

  // --- Banking, payments, brokerage -----------------------------------------
  'chase.com': 'critical', 'bankofamerica.com': 'critical', 'wellsfargo.com': 'critical',
  'citi.com': 'critical', 'citibank.com': 'critical', 'usbank.com': 'critical',
  'capitalone.com': 'critical', 'discover.com': 'critical', 'americanexpress.com': 'critical',
  'ally.com': 'critical', 'schwab.com': 'critical', 'fidelity.com': 'critical',
  'vanguard.com': 'critical', 'etrade.com': 'critical', 'robinhood.com': 'critical',
  'paypal.com': 'critical', 'venmo.com': 'critical', 'wise.com': 'critical',
  'stripe.com': 'critical', 'squareup.com': 'critical', 'cash.app': 'critical',
  'revolut.com': 'critical', 'monzo.com': 'critical', 'barclays.co.uk': 'critical',
  'hsbc.com': 'critical', 'lloydsbank.com': 'critical', 'natwest.com': 'critical',
  'coinbase.com': 'critical', 'binance.com': 'critical', 'kraken.com': 'critical',
  'blockchain.com': 'critical', 'gemini.com': 'critical', 'intuit.com': 'critical',

  // --- Government and health -------------------------------------------------
  'irs.gov': 'critical', 'ssa.gov': 'critical', 'login.gov': 'critical',
  'id.me': 'critical', 'healthcare.gov': 'critical', 'medicare.gov': 'critical',
  'gov.uk': 'critical', 'hmrc.gov.uk': 'critical',

  // --- Infrastructure the user can do real damage from ----------------------
  'amazonaws.com': 'critical', 'cloud.google.com': 'critical',
  'azure.com': 'critical', 'digitalocean.com': 'critical', 'cloudflare.com': 'critical',
  'linode.com': 'critical', 'vercel.com': 'critical', 'netlify.com': 'critical',
  'heroku.com': 'critical', 'github.com': 'critical', 'gitlab.com': 'critical',
  'bitbucket.org': 'critical', 'npmjs.com': 'critical', 'pypi.org': 'critical',
  'docker.com': 'critical', 'namecheap.com': 'critical', 'godaddy.com': 'critical',
  'porkbun.com': 'critical',

  // --- Work and document surfaces -------------------------------------------
  'slack.com': 'high', 'notion.so': 'high', 'atlassian.com': 'high',
  'atlassian.net': 'high', 'linear.app': 'high', 'asana.com': 'high',
  'monday.com': 'high', 'trello.com': 'high', 'clickup.com': 'high',
  'dropbox.com': 'high', 'box.com': 'high', 'figma.com': 'high',
  'salesforce.com': 'high', 'hubspot.com': 'high', 'zoom.us': 'high',
  'workday.com': 'high', 'adp.com': 'high', 'gusto.com': 'high',
  'docusign.com': 'high',

  // --- Social: impersonation and password-reset vectors ---------------------
  'facebook.com': 'high', 'instagram.com': 'high', 'x.com': 'high',
  'twitter.com': 'high', 'linkedin.com': 'high', 'reddit.com': 'high',
  'discord.com': 'high', 'telegram.org': 'high', 'whatsapp.com': 'high',
  'snapchat.com': 'high', 'tiktok.com': 'high', 'pinterest.com': 'medium',
  'tumblr.com': 'medium', 'mastodon.social': 'medium', 'bsky.app': 'medium',

  // --- Commerce: stored cards and addresses ---------------------------------
  'amazon.com': 'high', 'ebay.com': 'high', 'etsy.com': 'medium',
  'walmart.com': 'high', 'target.com': 'medium', 'bestbuy.com': 'medium',
  'shopify.com': 'high', 'doordash.com': 'medium', 'uber.com': 'high',
  'lyft.com': 'high', 'airbnb.com': 'high', 'booking.com': 'high',
  'expedia.com': 'medium', 'aliexpress.com': 'medium',

  // --- Low blast radius ------------------------------------------------------
  'netflix.com': 'medium', 'spotify.com': 'low', 'youtube.com': 'low',
  'twitch.tv': 'low', 'hulu.com': 'medium', 'disneyplus.com': 'medium',
  'steampowered.com': 'high', 'epicgames.com': 'high', 'roblox.com': 'medium',
  'wikipedia.org': 'low', 'stackoverflow.com': 'low', 'medium.com': 'low',
  'nytimes.com': 'low', 'imgur.com': 'low', 'archive.org': 'low'
};

/**
 * Substring hints applied to the registrable domain when it is not listed above.
 * @type {Array<[RegExp, import('../src/core/risk.js').RiskTier]>}
 */
export const KEYWORD_RISK = [
  [/(bank|banking|creditunion|savings|mortgage|lending)/i, 'critical'],
  [/(pay|wallet|invoice|billing|payroll|tax|crypto|coin|exchange|trading|broker)/i, 'critical'],
  [/(mail|inbox|webmail)/i, 'critical'],
  [/(health|clinic|medical|patient|insurance|pharmacy|hospital)/i, 'critical'],
  [/(admin|console|dashboard|portal|manage|cpanel)/i, 'high'],
  [/(cloud|server|hosting|domain|registrar)/i, 'high'],
  [/(shop|store|cart|checkout|order)/i, 'medium']
];

/**
 * TLDs that carry inherent risk regardless of the second-level label.
 * @type {Array<[RegExp, import('../src/core/risk.js').RiskTier]>}
 */
export const TLD_RISK = [
  [/\.gov(\.[a-z]{2})?$/i, 'critical'],
  [/\.bank$/i, 'critical'],
  [/\.insurance$/i, 'critical'],
  [/\.edu(\.[a-z]{2})?$/i, 'high']
];
