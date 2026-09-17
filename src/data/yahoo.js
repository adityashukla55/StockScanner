/**
 * Thin wrapper around Yahoo Finance's public chart/search endpoints.
 * No API key required. Includes a small TTL cache and host failover so we
 * stay well under Yahoo's informal rate limits while polling.
 */
import { settings } from '../settings.js';

import { HOSTS } from './hosts.js';

/**
 * How long a quote is reused before refetching.
 *
 * Five seconds suits one person at a desk. On a deployment several people
 * share this cache, so a longer window cuts upstream traffic roughly in
 * proportion — and costs almost nothing real, since the free data is already
 * delayed by up to fifteen minutes at source.
 */
const quoteTtlMs = () => Math.max(1, Number(settings().quoteCacheSeconds) || 5) * 1000;

const cache = new Map(); // key -> { expires, value }

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function toCache(key, value, ttlMs) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
}

/**
 * Requests already on the wire, keyed by path.
 *
 * The TTL cache only helps once a fetch has *finished*. Several visitors
 * polling the same ticker at the same moment all missed it and all called
 * Yahoo — measured at ten simultaneous requests producing ten upstream calls.
 * Sharing the in-flight promise collapses those into one.
 */
const inFlight = new Map();

async function fetchJson(path, ttlMs) {
  let lastError;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        lastError = new Error(`Yahoo responded ${res.status} for ${path}`);
        lastError.status = res.status === 404 ? 404 : 502;
        continue;
      }
      const json = await res.json();
      if (ttlMs) toCache(path, json, ttlMs);
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Yahoo request failed');
}

function getJson(path, { ttlMs = 0 } = {}) {
  if (ttlMs) {
    const hit = fromCache(path);
    if (hit) return Promise.resolve(hit);
  }

  const pending = inFlight.get(path);
  if (pending) return pending;

  // Cleared on settle either way: a failure must not be remembered as pending.
  const request = fetchJson(path, ttlMs).finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
}

/** Search symbols by name or ticker, restricted to US equities and ETFs. */
export async function search(query) {
  const path = `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0`;
  const json = await getJson(path, { ttlMs: 5 * 60_000 });

  return (json.quotes ?? [])
    .filter((q) => q.symbol && ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(q.quoteType))
    .filter((q) => {
      // An earlier version dropped every symbol containing a dot, because a
      // suffix means a non-US listing (SAP.DE, RELIANCE.NS, BP.L) and the app
      // was US-only. It is not any more, and Yahoo serves those listings with
      // the same quotes and candles — so the suffix is now information to show
      // rather than a reason to hide the result.
      //
      // Yahoo's internal fund identifiers are still not tradable tickers.
      return !/^0P[0-9A-Z]{8,}$/.test(q.symbol);
    })
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      type: q.quoteType,
      exchange: q.exchDisp || q.exchange,
      sector: q.sector ?? null,
    }));
}

function normalizeMeta(meta) {
  const price = meta.regularMarketPrice ?? null;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = price != null && prevClose != null ? price - prevClose : null;

  return {
    symbol: meta.symbol,
    name: meta.longName || meta.shortName || meta.symbol,
    type: meta.instrumentType,
    exchange: meta.fullExchangeName || meta.exchangeName,
    currency: meta.currency ?? 'USD',
    price,
    previousClose: prevClose,
    change,
    // Yahoo's own percent already accounts for splits/pre-post edge cases.
    changePercent:
      meta.regularMarketChangePercent ??
      (change != null && prevClose ? (change / prevClose) * 100 : null),
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    volume: meta.regularMarketVolume ?? null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    timezone: meta.exchangeTimezoneName ?? 'America/New_York',
    firstTradeDate: meta.firstTradeDate ? meta.firstTradeDate * 1000 : null,
  };
}

/** Latest quote for one symbol, derived from the chart endpoint's meta block. */
export async function quote(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const json = await getJson(path, { ttlMs: quoteTtlMs() });
  const result = json?.chart?.result?.[0];
  if (!result) {
    const err = new Error(`Unknown symbol: ${symbol}`);
    err.status = 404;
    throw err;
  }
  return normalizeMeta(result.meta);
}

/** OHLC candles plus the quote meta for a symbol over the given range. */
export async function history(symbol, range, interval) {
  const path =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}` +
    `&includePrePost=false&events=div%2Csplit`;

  // Intraday data moves constantly; daily candles only change once a session.
  const ttlMs = interval.endsWith('m') || interval.endsWith('h') ? 15_000 : 10 * 60_000;
  const json = await getJson(path, { ttlMs });

  const result = json?.chart?.result?.[0];
  if (!result) {
    const err = new Error(`No history for ${symbol} (${range}/${interval})`);
    err.status = 404;
    throw err;
  }

  const stamps = result.timestamp ?? [];
  const ohlc = result.indicators?.quote?.[0] ?? {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose;

  const candles = stamps
    .map((t, i) => ({
      t: t * 1000,
      open: ohlc.open?.[i] ?? null,
      high: ohlc.high?.[i] ?? null,
      low: ohlc.low?.[i] ?? null,
      close: adjClose?.[i] ?? ohlc.close?.[i] ?? null,
      volume: ohlc.volume?.[i] ?? null,
    }))
    // Yahoo pads the series with null candles for halted/holiday slots.
    .filter((c) => c.close != null);

  return {
    meta: normalizeMeta(result.meta),
    previousClose: result.meta.chartPreviousClose ?? null,
    candles,
  };
}

/**
 * Normalized performance for several symbols over one range, aligned onto a
 * shared timeline so the client can plot them as overlaid percentage series.
 *
 * Each symbol is indexed to its own first candle inside the range, which is how
 * comparison charts stay meaningful when one holding listed later than another.
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

  const timeline = [...new Set(loaded.flatMap((s) => s.data.candles.map((c) => c.t)))].sort(
    (a, b) => a - b,
  );

  // Carry the last known close forward so a symbol that skips a bar (halt,
  // different listing calendar) doesn't punch a hole in the others' rows.
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
    failed: settled
      .map((r, i) => (r.status === 'rejected' ? symbols[i] : null))
      .filter(Boolean),
  };
}
