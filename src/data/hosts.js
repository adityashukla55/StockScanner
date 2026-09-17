/**
 * Where Yahoo lives, and where it lives during `npm run dev`.
 *
 * Host permissions exempt the extension from CORS; a page on localhost has no
 * such exemption, so the dev server routes through scripts/dev-proxy.mjs. The
 * condition resolves at build time and the dev branch is dropped from the
 * bundle entirely.
 *
 * These were previously spelled out in four modules, three of which built
 * absolute URLs and so quietly ignored the proxy — company profiles and implied
 * volatility failed on localhost for that reason alone, which was invisible
 * until a screenshot of the dev server showed "Failed to fetch" to the world.
 */
const PROXY = 'http://127.0.0.1:5310';
//  guard so this module still imports cleanly in Node, where the flag
// does not exist; Vite replaces the identifier with a literal, after which the
// whole expression folds and the proxy branch disappears from the build.
const DEV = typeof __DEV_PROXY__ !== 'undefined' && __DEV_PROXY__;

export const Q1 = DEV ? `${PROXY}/q1` : 'https://query1.finance.yahoo.com';
export const Q2 = DEV ? `${PROXY}/q2` : 'https://query2.finance.yahoo.com';

/** Issues the session cookie that the crumb, and so quoteSummary, depends on. */
export const FC = DEV ? `${PROXY}/fc` : 'https://fc.yahoo.com';

/** Tried in order; the second is a straight failover for the first. */
export const HOSTS = [Q1, Q2];
