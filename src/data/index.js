/**
 * What the Express routes used to do.
 *
 * The web app put an HTTP boundary here because the browser could not call
 * Yahoo itself. An extension can, so the boundary is gone and these are plain
 * function calls — but the argument handling is kept exactly as the routes had
 * it, because the caps are real protections rather than plumbing: the 40-symbol
 * quote limit, the 8-symbol comparison limit and the range/interval pairing all
 * exist because Yahoo rejects or punishes the alternatives.
 */
import * as market from './market.js';
import { projectionModel, projectionModels } from './projection.js';
import { profile as profileFor } from './profile.js';
import { impliedVolatility } from './impliedVol.js';
import { portfolioStats } from './portfolio.js';

/** Range -> candle interval. Yahoo rejects mismatched pairs (e.g. 1m over 5y). */
export const RANGES = {
  '1d': '2m',
  '5d': '15m',
  '1mo': '1d',
  '6mo': '1d',
  ytd: '1d',
  '1y': '1d',
  '5y': '1wk',
  '10y': '1mo',
  max: '1mo',
};

const tickers = (input, limit) =>
  (Array.isArray(input) ? input : String(input ?? '').split(','))
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean)
    .slice(0, limit);

function intervalFor(range) {
  if (!(range in RANGES)) {
    throw new Error(`Unsupported range. Use one of: ${Object.keys(RANGES).join(', ')}`);
  }
  return RANGES[range];
}

export const search = (query) => {
  const q = String(query ?? '').trim();
  return q ? market.search(q) : Promise.resolve([]);
};

export const quotes = (symbols) => market.quotes(tickers(symbols, 40));

export const quote = (symbol) => market.quote(symbol);

export const profile = (symbol) => profileFor(symbol);

export const impliedVol = (symbol) => impliedVolatility(symbol);

export async function history(symbol, range = '1y') {
  const interval = intervalFor(range);
  return { range, interval, ...(await market.history(symbol, range, interval)) };
}

export async function compare(symbols, range = '1y') {
  const list = tickers(symbols, 8);
  if (!list.length) return { series: [], rows: [], failed: [] };
  const interval = intervalFor(range);
  return { range, interval, ...(await market.compare(list, range, interval)) };
}

export function portfolio(symbols, lookback = '5y') {
  const list = tickers(symbols, 8);
  if (list.length < 2) return Promise.reject(new Error('Pick at least two symbols.'));
  return portfolioStats(list, lookback);
}

export const projection = (symbol, lookback = '10y') => projectionModel(symbol, lookback);

export function projections(symbols, lookback = '10y') {
  const list = tickers(symbols, 25);
  return list.length ? projectionModels(list, lookback) : Promise.resolve({ models: [], failed: [] });
}
