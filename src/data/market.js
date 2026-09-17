/**
 * The data source, behind one door.
 *
 * Every view reaches prices through this module rather than calling a vendor
 * directly, so replacing the source means rewriting one file. That mattered
 * more than it sounds: Yahoo's endpoints are undocumented and could stop
 * answering, and this is the seam a licensed feed would slot into.
 */
import { settings } from '../settings.js';
import * as yahoo from './yahoo.js';

/**
 * Option chains are Yahoo-only. OPTIONS_PROVIDER=off turns the feature off
 * instead, which the projection tab already handles by falling back to
 * historical volatility.
 */
export const optionsProvider = () =>
  (settings().optionsProvider ?? 'yahoo').toLowerCase() === 'off' ? 'off' : 'yahoo';

export const search = (query) => yahoo.search(query);

export const quote = (symbol) => yahoo.quote(symbol);

/**
 * Several quotes at once.
 *
 * Yahoo has no batch endpoint, so a watchlist refresh is one request per symbol.
 * They are settled rather than awaited in sequence, and a symbol that fails is
 * reported instead of taking the others down with it — one delisted ticker
 * should not blank the whole watchlist.
 */
export async function quotes(symbols) {
  if (!symbols.length) return { quotes: [], failed: [] };

  const settled = await Promise.allSettled(symbols.map((s) => yahoo.quote(s)));
  return {
    quotes: settled.filter((r) => r.status === 'fulfilled').map((r) => r.value),
    failed: symbols.filter((_, i) => settled[i].status === 'rejected'),
  };
}

export const history = (symbol, range, interval) => yahoo.history(symbol, range, interval);

/**
 * Normalised percentage series for several symbols on one timeline.
 *
 * Provider-agnostic: it only needs `history`, so it works the same either way.
 * Each symbol is indexed to its own first candle inside the range, which keeps
 * the comparison honest when one holding listed later than another.
 */
export async function compare(symbols, range, interval) {
  const settled = await Promise.allSettled(symbols.map((s) => history(s, range, interval)));

  const loaded = settled
    .map((r, i) => ({ symbol: symbols[i], result: r }))
    .filter((x) => x.result.status === 'fulfilled')
    .map((x) => ({
      symbol: x.symbol,
      data: x.result.value,
      byTime: new Map(x.result.value.candles.map((c) => [c.t, c.close])),
    }));

  const timeline = [...new Set(loaded.flatMap((s) => s.data.candles.map((c) => c.t)))].sort((a, b) => a - b);
  const cursors = loaded.map(() => ({ last: null, base: null }));

  const rows = timeline.map((t) => {
    const row = { t };
    loaded.forEach((s, i) => {
      const close = s.byTime.get(t);
      if (close != null) cursors[i].last = close;
      if (cursors[i].last == null) {
        row[s.symbol] = null; // Not listed yet at this point in the range.
        return;
      }
      cursors[i].base ??= cursors[i].last;
      row[s.symbol] = ((cursors[i].last - cursors[i].base) / cursors[i].base) * 100;
    });
    return row;
  });

  const series = loaded.map((s, i) => {
    const last = [...rows].reverse().find((r) => r[s.symbol] != null);
    return {
      symbol: s.symbol,
      name: s.data.meta.name,
      type: s.data.meta.type,
      // Each series keeps its own unit: a comparison may span exchanges, and
      // the table below the chart shows real prices alongside the percentages.
      currency: s.data.meta.currency,
      price: s.data.meta.price,
      changePercent: s.data.meta.changePercent,
      periodReturn: last ? last[s.symbol] : null,
      baseline: cursors[i].base,
    };
  });

  return {
    series,
    rows,
    failed: settled.map((r, i) => (r.status === 'rejected' ? symbols[i] : null)).filter(Boolean),
  };
}
