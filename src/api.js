/**
 * The seam the components call.
 *
 * In the web app every one of these was an HTTP request to our own server,
 * which then called Yahoo. The extension calls Yahoo itself, so the same
 * functions now run the same code in-process — the signatures are unchanged,
 * which is why no component needed touching.
 *
 * The cache in front of them is still worth having, though less for the network
 * than for the arithmetic: views are rendered conditionally, so switching tabs
 * unmounts one component and mounts another, and a mount re-runs whatever the
 * view needs. Refitting a ten-year projection because someone looked at another
 * tab and came back is wasted work whether or not a request goes out.
 */
import * as data from './data/index.js';
import { settings } from './settings.js';

const MINUTE = 60_000;
const MAX_ENTRIES = 200;

const cache = new Map();
const inFlight = new Map();

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Re-insert so iteration order is least-recently-used first.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function toCache(key, value, ttl) {
  if (!ttl) return;
  cache.set(key, { value, expires: Date.now() + ttl });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

/** Components branch on `err.name`, so this has to look like a real abort. */
const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

/**
 * Give one caller its own abort behaviour over a possibly shared call.
 *
 * The underlying work is deliberately not cancelled: several components can be
 * waiting on it, and one of them unmounting must not fail the others. Letting
 * it finish also fills the cache for whoever asks next.
 */
function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    const release = () => signal.removeEventListener('abort', onAbort);
    promise.then(resolve, reject);
    promise.then(release, release);
  });
}

/**
 * Run `work` under a cache key, sharing anything already in progress.
 *
 * Yahoo responses are cached a second time inside `data/yahoo.js`; these TTLs
 * sit in front of the fitting and statistics that run on top of them, so they
 * are keyed by what the view asked for rather than by URL.
 */
function cached(key, ttl, work, signal) {
  const hit = ttl ? fromCache(key) : undefined;
  if (hit !== undefined) return withAbort(Promise.resolve(hit), signal);

  let shared = inFlight.get(key);
  if (!shared) {
    shared = work()
      .then((value) => {
        toCache(key, value, ttl);
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, shared);
  }
  return withAbort(shared, signal);
}

/** Intraday candles move through the session; daily ones are settled history. */
const historyTtl = (range) => (range === '1d' || range === '5d' ? 15_000 : MINUTE);

/** Quotes are polled on a timer; cache only long enough to collapse a tab switch. */
const quoteTtl = () => Math.min(5_000, Math.max(1, settings().pollSeconds) * 1000);

export const searchSymbols = (q, signal) =>
  cached(`search:${q}`, 5 * MINUTE, () => data.search(q), signal);

export const fetchQuotes = (symbols, signal) =>
  symbols.length
    ? cached(`quotes:${symbols.join(',')}`, quoteTtl(), () => data.quotes(symbols).then((d) => d.quotes), signal)
    : Promise.resolve([]);

export const fetchHistory = (symbol, range, signal) =>
  cached(`history:${symbol}:${range}`, historyTtl(range), () => data.history(symbol, range), signal);

export const fetchCompare = (symbols, range, signal) =>
  cached(`compare:${symbols.join(',')}:${range}`, historyTtl(range), () => data.compare(symbols, range), signal);

export const fetchProjection = (symbol, lookback, signal) =>
  cached(`projection:${symbol}:${lookback}`, 10 * MINUTE, () => data.projection(symbol, lookback), signal);

export const fetchProfile = (symbol, signal) =>
  cached(`profile:${symbol}`, 10 * MINUTE, () => data.profile(symbol), signal);

export const fetchProjections = (symbols, lookback, signal) =>
  cached(`projections:${symbols.join(',')}:${lookback}`, 10 * MINUTE, () => data.projections(symbols, lookback), signal);

export const fetchImpliedVol = (symbol, signal) =>
  cached(`iv:${symbol}`, 10 * MINUTE, () => data.impliedVol(symbol), signal);

export const fetchPortfolio = (symbols, lookback, signal) =>
  cached(`portfolio:${symbols.join(',')}:${lookback}`, 10 * MINUTE, () => data.portfolio(symbols, lookback), signal);

// Storage is local and immediate now, so these are pass-throughs rather than
// requests. They keep their old shapes because App.jsx reads `exists`.
import { readState, writeState } from './storage.js';

export const fetchState = () => readState();
export const saveState = (patch) => writeState(patch);
