/**
 * Black-76 pricing and implied-volatility inversion.
 *
 * We price off the forward rather than the spot, because the forward and the
 * discount factor can both be recovered from the option quotes themselves via
 * put-call parity. That avoids having to assume a risk-free rate or a dividend
 * yield — and assuming them wrongly is exactly what makes Yahoo's own
 * impliedVolatility field disagree between calls and puts at the same strike.
 */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/** Black-76 price of a call or put on a forward F, discounted by D. */
export function black76({ forward, strike, years, vol, discount, isCall }) {
  if (!(years > 0) || !(vol > 0) || !(forward > 0) || !(strike > 0)) return null;
  const sd = vol * Math.sqrt(years);
  const d1 = (Math.log(forward / strike) + (sd * sd) / 2) / sd;
  const d2 = d1 - sd;
  return isCall
    ? discount * (forward * normalCdf(d1) - strike * normalCdf(d2))
    : discount * (strike * normalCdf(-d2) - forward * normalCdf(-d1));
}

/**
 * Implied volatility by bisection.
 *
 * Bisection rather than Newton: vega collapses for deep in- or out-of-the-money
 * contracts and Newton then diverges, while bisection on a bracketed, monotone
 * function simply converges.
 */
export function impliedVol({ price, forward, strike, years, discount, isCall }) {
  if (!(price > 0) || !(years > 0) || !(forward > 0) || !(strike > 0)) return null;

  // Below intrinsic there is no solution — the quote is stale or crossed.
  const intrinsic = discount * Math.max(0, isCall ? forward - strike : strike - forward);
  if (price < intrinsic - 1e-8) return null;

  let lo = 1e-4;
  let hi = 5;
  if (black76({ forward, strike, years, vol: hi, discount, isCall }) < price) return null;

  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    const value = black76({ forward, strike, years, vol: mid, discount, isCall });
    if (value > price) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

/**
 * Recover the discount factor and forward price from put-call parity.
 *
 * For every strike, C - P = D·(F - K). Regressing (C - P) against K gives a
 * line of slope -D and intercept D·F, so a set of strikes pins down both
 * unknowns without needing a rate or dividend input.
 */
export function forwardFromParity(pairs) {
  if (pairs.length < 2) return null;

  const n = pairs.length;
  const meanK = pairs.reduce((s, p) => s + p.strike, 0) / n;
  const meanY = pairs.reduce((s, p) => s + (p.call - p.put), 0) / n;

  let cov = 0;
  let varK = 0;
  for (const p of pairs) {
    cov += (p.strike - meanK) * (p.call - p.put - meanY);
    varK += (p.strike - meanK) ** 2;
  }
  if (varK === 0) return null;

  const slope = cov / varK;
  const discount = -slope;
  // A discount factor outside this band means the quotes are not internally
  // consistent, and anything derived from them would be noise.
  if (!(discount > 0.5 && discount <= 1.05)) return null;

  const forward = (meanY + discount * meanK) / discount;
  if (!(forward > 0)) return null;

  return { discount: Math.min(discount, 1), forward };
}
