import { settings } from '../settings.js';
/**
 * Option-implied volatility: the market's own forward-looking estimate of how
 * much a symbol will move, priced by people with money at stake.
 *
 * Note what it is and isn't. Options price the *spread*, not the direction:
 * their implied drift is the risk-free rate, a pricing convention rather than a
 * forecast. Nothing here says which way a price will go.
 *
 * We do not use Yahoo's own `impliedVolatility` field. It disagrees between
 * calls and puts at the same strike — 22.6% against 13.5% on a one-year SPY
 * contract — because it appears to ignore dividends. Instead we take the quoted
 * prices, recover the forward and discount factor from put-call parity, and
 * invert Black-76 ourselves. Calls and puts then agree, which doubles as a
 * check that the quotes are sane.
 */
import { authedJson } from './session.js';
import { Q1 } from './hosts.js';
import { forwardFromParity, impliedVol } from './blackScholes.js';

const CACHE_TTL = 15 * 60_000;
const DAY = 86_400;

// Roughly a month, a quarter, half a year, a year, and as far out as trades.
const TARGET_DAYS = [30, 91, 182, 365, 730];

// A quote is only usable if someone is actually making a market in it.
const MAX_RELATIVE_SPREAD = 0.4;
const MIN_INTEREST = 5;
// Calls and puts at one strike must imply the same volatility. A wider gap
// means the quotes are stale or crossed, whatever the mid-prices suggest.
const MAX_CALL_PUT_GAP = 0.04;

const cache = new Map();

const chainUrl = (symbol, expiry) => (crumb) =>
  `${Q1}/v7/finance/options/${encodeURIComponent(symbol)}` +
  `?crumb=${encodeURIComponent(crumb)}${expiry ? `&date=${expiry}` : ''}`;

function usableQuote(contract) {
  if (!contract) return null;
  const { bid, ask } = contract;
  if (!(bid > 0) || !(ask > bid)) return null;

  const mid = (bid + ask) / 2;
  if ((ask - bid) / mid > MAX_RELATIVE_SPREAD) return null;
  if ((contract.openInterest ?? 0) < MIN_INTEREST && (contract.volume ?? 0) < 1) return null;

  return mid;
}

/** At-the-money implied volatility for one expiry, derived from the quotes. */
function volForExpiry(chain, spot, years) {
  const calls = new Map();
  const puts = new Map();
  for (const c of chain?.calls ?? []) {
    const mid = usableQuote(c);
    if (mid != null) calls.set(c.strike, mid);
  }
  for (const p of chain?.puts ?? []) {
    const mid = usableQuote(p);
    if (mid != null) puts.set(p.strike, mid);
  }

  // Strikes with a liquid quote on both sides, nearest the money first.
  const pairs = [...calls.keys()]
    .filter((k) => puts.has(k))
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, 8)
    .map((strike) => ({ strike, call: calls.get(strike), put: puts.get(strike) }));

  if (pairs.length < 3) return null;

  const parity = forwardFromParity(pairs);
  if (!parity) return null;
  const { forward, discount } = parity;

  const atm = pairs.reduce((best, p) =>
    Math.abs(p.strike - forward) < Math.abs(best.strike - forward) ? p : best,
  );

  const shared = { forward, strike: atm.strike, years, discount };
  const callVol = impliedVol({ ...shared, price: atm.call, isCall: true });
  const putVol = impliedVol({ ...shared, price: atm.put, isCall: false });
  if (callVol == null || putVol == null) return null;
  if (Math.abs(callVol - putVol) > MAX_CALL_PUT_GAP) return null;

  return {
    impliedVol: (callVol + putVol) / 2,
    callVol,
    putVol,
    strike: atm.strike,
    forward,
    strikesUsed: pairs.length,
  };
}

export async function impliedVolatility(symbol) {
  const key = symbol.toUpperCase();

  // Option chains are the one Yahoo endpoint needing an authenticated session,
  // so this setting exists to switch the feature off entirely. The projection
  // tab already handles the answer, falling back to historical volatility.
  if ((settings().optionsProvider ?? 'yahoo').toLowerCase() === 'off') {
    return { symbol: key, supported: false, reason: 'Option data is turned off', points: [], longest: null };
  }
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const { json } = await authedJson(chainUrl(key, null));
  const root = json?.optionChain?.result?.[0];

  const unsupported = (reason) => {
    const value = { symbol: key, supported: false, reason, points: [], longest: null };
    cache.set(key, { value, expires: Date.now() + CACHE_TTL });
    return value;
  };

  // Plenty of ETFs and smaller names have no listed options at all.
  if (!root?.expirationDates?.length) return unsupported('No listed options');

  const spot = root.quote?.regularMarketPrice ?? null;
  if (!(spot > 0)) return unsupported('No price available');

  const now = Date.now() / 1000;
  const available = root.expirationDates;

  const chosen = [...new Set(
    TARGET_DAYS.map((days) => {
      const target = now + days * DAY;
      return available.reduce((best, d) => (Math.abs(d - target) < Math.abs(best - target) ? d : best));
    }),
  )];

  const settled = await Promise.allSettled(
    chosen.map(async (expiry) => {
      const years = (expiry - now) / (365.25 * DAY);
      if (years <= 0) return null;

      // The nearest expiry's chain arrived with the initial request already.
      const chain =
        root.options?.[0]?.expirationDate === expiry
          ? root.options[0]
          : (await authedJson(chainUrl(key, expiry))).json?.optionChain?.result?.[0]?.options?.[0];

      const vol = volForExpiry(chain, spot, years);
      if (!vol) return null;
      return { expiry: expiry * 1000, days: Math.round((expiry - now) / DAY), years, ...vol };
    }),
  );

  const points = settled
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value)
    .sort((a, b) => a.days - b.days);

  if (!points.length) return unsupported('Options too thinly traded to price reliably');

  const value = {
    symbol: key,
    supported: true,
    spot,
    points,
    // The furthest-dated quote is the best anchor for a long horizon, though
    // using it past its own expiry is still extrapolation.
    longest: points[points.length - 1],
  };

  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}
