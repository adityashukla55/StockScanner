/**
 * Estimates a lognormal (geometric Brownian motion) model for a symbol from its
 * own price history: the annualized log-drift and volatility of its daily returns.
 *
 * The server only fits the model — the client turns it into scenarios, so moving
 * the amount or horizon sliders doesn't need a round trip.
 */
import { history } from './market.js';

const TRADING_DAYS = 252;

const LOOKBACKS = {
  '1y': '1d',
  '5y': '1d',
  '10y': '1d',
  max: '1mo',
};

export const LOOKBACK_RANGES = Object.keys(LOOKBACKS);

export async function projectionModel(symbol, lookback = '10y') {
  const interval = LOOKBACKS[lookback];
  if (!interval) {
    const err = new Error(`Unsupported lookback. Use one of: ${LOOKBACK_RANGES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const { meta, candles } = await history(symbol, lookback, interval);

  if (candles.length < 31) {
    const err = new Error(`${symbol} has too little history to estimate a model.`);
    err.status = 422;
    throw err;
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  const spanYears = (last.t - first.t) / (365.25 * 24 * 3600 * 1000);

  // Measure the sampling rate rather than trusting the requested interval:
  // Yahoo quietly downgrades some range/interval pairs (a `1wk` request over
  // `max` comes back monthly), and annualizing by the wrong factor would
  // inflate both the drift and the volatility.
  const periodsPerYear = spanYears > 0 ? (candles.length - 1) / spanYears : TRADING_DAYS;

  const logReturns = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) logReturns.push(Math.log(curr / prev));
  }

  if (logReturns.length < 30) {
    const err = new Error(
      `${symbol} has only ${logReturns.length} usable periods of history — too short to estimate a model.`,
    );
    err.status = 422;
    throw err;
  }

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  // Sample variance (n-1): we are estimating from a sample, not the population.
  const variance =
    logReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (logReturns.length - 1);

  const driftAnnual = mean * periodsPerYear;
  const volAnnual = Math.sqrt(variance * periodsPerYear);

  const cagr = spanYears > 0 ? (last.close / first.close) ** (1 / spanYears) - 1 : null;

  // Worst peak-to-trough fall actually lived through in this window. The drift
  // and volatility pair hides this; a holder experiences it directly.
  let peak = candles[0].close;
  let maxDrawdown = 0;
  for (const candle of candles) {
    if (candle.close > peak) peak = candle.close;
    const fall = (candle.close - peak) / peak;
    if (fall < maxDrawdown) maxDrawdown = fall;
  }

  return {
    symbol: meta.symbol,
    name: meta.name,
    type: meta.type,
    currency: meta.currency,
    price: meta.price ?? last.close,
    model: {
      driftAnnual, // Continuously compounded; exp(driftAnnual) - 1 is the median year.
      volAnnual,
      cagr,
      maxDrawdown,
      samples: logReturns.length,
      periodsPerYear,
      from: first.t,
      to: last.t,
      spanYears,
      lookback,
      interval,
    },
  };
}

/** Fit the same model across several symbols, for side-by-side comparison. */
export async function projectionModels(symbols, lookback = '10y') {
  const settled = await Promise.allSettled(symbols.map((s) => projectionModel(s, lookback)));
  return {
    models: settled.filter((r) => r.status === 'fulfilled').map((r) => r.value),
    failed: symbols.filter((_, i) => settled[i].status === 'rejected'),
  };
}
