/**
 * Where a setup lives.
 *
 * The web app wrote a JSON file the server owned, and the deployed copy kept
 * nothing at all — each visitor's setup rode along in their URL fragment,
 * because one global file would have been one setup shared by everyone.
 *
 * Neither problem exists here. The extension is one person's, so storage is
 * simply theirs: `storage.sync` carries the watchlist, holdings,
 * comparison and theme to every Chrome they are signed into, and falls back to
 * comparison and theme to every browser profile they are signed into, falling
 * back to `local` when sync is unavailable or the payload outgrows its quota.
 *
 * Shape and sanitising are unchanged from the server's store, so a setup moves
 * between the two without translation.
 */
import { browserApi } from './browser.js';
const KEY = 'state';
const EMPTY = { watchlist: null, compare: null, holdings: null, picks: null, theme: null };

/** Keep only the shapes we expect, so hand-edited storage cannot break the app. */
export function sanitize(input) {
  const state = { ...EMPTY };
  if (!input || typeof input !== 'object') return state;

  const symbols = (value) =>
    Array.isArray(value)
      ? value.filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 12).slice(0, 100)
      : null;

  state.watchlist = symbols(input.watchlist);
  state.compare = symbols(input.compare);
  state.picks = symbols(input.picks);

  state.holdings = Array.isArray(input.holdings)
    ? input.holdings
        .filter((h) => h && typeof h.symbol === 'string' && h.symbol.length <= 12)
        .map((h) => ({
          symbol: h.symbol,
          shares: Number(h.shares) || 0,
          cost: Number(h.cost) || 0,
        }))
        .slice(0, 100)
    : null;

  state.theme = input.theme === 'dark' || input.theme === 'light' ? input.theme : null;
  return state;
}

/** sync first, then local — a setup saved before sync was available still loads. */
export async function readState() {
  for (const area of ['sync', 'local']) {
    try {
      const stored = await browserApi.storage[area].get(KEY);
      if (stored?.[KEY]) return { ...sanitize(stored[KEY]), exists: true };
    } catch {
      // Try the next area.
    }
  }
  return { ...EMPTY, exists: false };
}

export async function writeState(patch) {
  const next = sanitize({ ...(await readState()), ...patch });
  try {
    await browserApi.storage.sync.set({ [KEY]: next });
  } catch {
    // QUOTA_BYTES_PER_ITEM is 8 KB on sync; a large holdings list can exceed it.
    // Local has a much larger budget and no sync, which is the right trade when
    // the alternative is losing the edit.
    await browserApi.storage.local.set({ [KEY]: next });
  }
  return next;
}
