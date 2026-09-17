/**
 * Portfolio statistics for the allocation tab.
 *
 * The single-ticker projection treats each holding alone. A portfolio is not
 * the sum of its parts: what matters is how the holdings move *together*, so
 * this module returns the covariance and correlation of their returns as well
 * as each one's own drift and volatility. Two holdings correlated at 0.9 give
 * almost no diversification; at 0.2 they cancel a great deal of each other's
 * noise, and only the covariance matrix shows the difference.
 *
 * Returns here are simple (P_t/P_{t-1} - 1), not log returns, because a
 * portfolio's return is the weighted sum of its holdings' *simple* returns.
 * Weighting log returns would be quietly wrong.
 */
import { history } from './market.js';

const LOOKBACKS = { '1y': '1d', '5y': '1d', '10y': '1d', max: '1mo' };

export const PORTFOLIO_LOOKBACKS = Object.keys(LOOKBACKS);

const dateFormatters = new Map();

/**
 * The calendar date a candle belongs to, in its own exchange's timezone.
 *
 * Yahoo stamps a daily candle with the moment that session opened, so the same
 * Monday is a different epoch on every exchange — 13:30 UTC in New York, 08:00
 * in Frankfurt, 03:45 in Mumbai. Matching on the raw timestamp therefore found
 * almost nothing in common between markets, and a portfolio mixing them failed
 * with "too little overlapping history" no matter how much history there was.
 *
 * Reducing each candle to its local calendar date makes Monday equal Monday.
 * Deriving it in the exchange's own zone rather than UTC matters for markets
 * that open before midnight UTC, such as Sydney.
 */
function dateKey(t, timeZone) {
  let format = dateFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, format);
  }
  return format.format(new Date(t));
}

/** Align several price series onto the trading days they all share. */
function alignedReturns(series) {
  const zones = series.map((s) => s.meta?.timezone ?? 'America/New_York');

  // One map per series: local calendar date -> { close, t }.
  const byDate = series.map(
    (s, i) => new Map(s.candles.map((c) => [dateKey(c.t, zones[i]), { close: c.close, t: c.t }])),
  );

  const counts = new Map();
  for (const map of byDate) {
    for (const key of map.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const shared = [...counts.entries()]
    .filter(([, n]) => n === series.length)
    .map(([key]) => key)
    .sort();

  const returns = series.map(() => []);
  for (let i = 1; i < shared.length; i += 1) {
    for (let a = 0; a < series.length; a += 1) {
      const prev = byDate[a].get(shared[i - 1]).close;
      const curr = byDate[a].get(shared[i]).close;
      returns[a].push(curr / prev - 1);
    }
  }

  // Callers measure the span in milliseconds, so hand back timestamps rather
  // than the date strings used for matching. The first series' clock is as good
  // as any for a span of years.
  const dates = shared.map((key) => byDate[0].get(key).t);
  return { dates, returns };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function covarianceMatrix(returns, periodsPerYear) {
  const n = returns.length;
  const means = returns.map(mean);
  const rows = returns[0].length;
  const cov = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let sum = 0;
      for (let k = 0; k < rows; k += 1) {
        sum += (returns[i][k] - means[i]) * (returns[j][k] - means[j]);
      }
      // Sample covariance (n-1), annualised.
      const value = (sum / (rows - 1)) * periodsPerYear;
      cov[i][j] = value;
      cov[j][i] = value;
    }
  }
  return cov;
}

export async function portfolioStats(symbols, lookback = '5y') {
  const interval = LOOKBACKS[lookback];
  if (!interval) {
    const err = new Error(`Unsupported lookback. Use one of: ${PORTFOLIO_LOOKBACKS.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const settled = await Promise.allSettled(symbols.map((s) => history(s, lookback, interval)));
  const loaded = settled
    .map((r, i) => ({ symbol: symbols[i], result: r }))
    .filter((x) => x.result.status === 'fulfilled' && x.result.value.candles.length > 30)
    .map((x) => ({ symbol: x.symbol, ...x.result.value }));

  const failed = symbols.filter((s) => !loaded.some((l) => l.symbol === s));
  if (loaded.length < 2) {
    const err = new Error('Need at least two symbols with usable history.');
    err.status = 422;
    throw err;
  }

  const { dates, returns } = alignedReturns(loaded);
  if (returns[0].length < 30) {
    const err = new Error('These symbols share too little overlapping history.');
    err.status = 422;
    throw err;
  }

  const spanYears = (dates[dates.length - 1] - dates[0]) / (365.25 * 24 * 3600 * 1000);
  // Measured, not assumed: Yahoo silently changes interval on some ranges.
  const periodsPerYear = spanYears > 0 ? (dates.length - 1) / spanYears : 252;

  const mu = returns.map((r) => mean(r) * periodsPerYear);
  const cov = covarianceMatrix(returns, periodsPerYear);
  const vol = cov.map((row, i) => Math.sqrt(row[i]));

  const correlation = cov.map((row, i) => row.map((c, j) => c / (vol[i] * vol[j] || 1)));

  const assets = loaded.map((s, i) => {
    const closes = s.candles.map((c) => c.close);
    let peak = closes[0];
    let maxDrawdown = 0;
    for (const close of closes) {
      if (close > peak) peak = close;
      const fall = (close - peak) / peak;
      if (fall < maxDrawdown) maxDrawdown = fall;
    }
    const years = (s.candles.at(-1).t - s.candles[0].t) / (365.25 * 24 * 3600 * 1000);

    return {
      symbol: s.meta.symbol,
      name: s.meta.name,
      type: s.meta.type,
      currency: s.meta.currency,
      price: s.meta.price,
      annualReturn: mu[i], // Arithmetic mean of simple returns, annualised.
      vol: vol[i],
      cagr: years > 0 ? (closes.at(-1) / closes[0]) ** (1 / years) - 1 : null,
      maxDrawdown,
    };
  });

  return {
    lookback,
    interval,
    spanYears,
    periodsPerYear,
    observations: returns[0].length,
    from: dates[0],
    to: dates[dates.length - 1],
    assets,
    covariance: cov,
    correlation,
    failed,
  };
}
