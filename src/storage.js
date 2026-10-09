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
import { MAX_GROUPS, MAX_GROUP_NAME, newGroupId } from './groups.js';
const KEY = 'state';
const EMPTY = {
  watchlist: null,
  compare: null,
  holdings: null,
  picks: null,
  theme: null,
  groups: null,
  activeGroup: null,
  savedAt: 0,
};

const symbols = (value) =>
  Array.isArray(value)
    ? value.filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 12).slice(0, 100)
    : null;

function sanitizeGroups(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const g of value) {
    if (out.length >= MAX_GROUPS) break;
    if (!g || typeof g.name !== 'string') continue;
    let id = typeof g.id === 'string' && /^[\w-]{1,40}$/.test(g.id) ? g.id : newGroupId();
    if (seen.has(id)) id = newGroupId();
    seen.add(id);
    out.push({
      id,
      name: g.name.trim().slice(0, MAX_GROUP_NAME) || 'Group',
      symbols: [...new Set(symbols(g.symbols) ?? [])],
    });
  }
  return out;
}

/** Keep only the shapes we expect, so hand-edited storage cannot break the app. */
export function sanitize(input) {
  const state = { ...EMPTY };
  if (!input || typeof input !== 'object') return state;

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

  state.groups = sanitizeGroups(input.groups);
  if (state.groups && state.watchlist) {
    const inGroups = state.groups.flatMap((g) => g.symbols);
    const missing = [...new Set(inGroups)].filter((s) => !state.watchlist.includes(s));
    if (missing.length) state.watchlist = [...state.watchlist, ...missing].slice(0, 100);
  }
  state.activeGroup = state.groups?.some((g) => g.id === input.activeGroup) ? input.activeGroup : null;
  state.savedAt = Number(input.savedAt) || 0;
  return state;
}

/** sync first, then local — a setup saved before sync was available still loads. */
export async function readState() {
  let best = null;
  for (const area of ['sync', 'local']) {
    try {
      const stored = await browserApi.storage[area].get(KEY);
      if (stored?.[KEY]) {
        const state = sanitize(stored[KEY]);
        if (!best || state.savedAt > best.savedAt) best = state;
      }
    } catch {
      // Try the next area.
    }
  }
  return best ? { ...best, exists: true } : { ...EMPTY, exists: false };
}

export async function writeState(patch) {
  const next = sanitize({ ...(await readState()), ...patch, savedAt: Date.now() });
  try {
    await browserApi.storage.sync.set({ [KEY]: next });
    return 'sync';
  } catch {
    // QUOTA_BYTES_PER_ITEM is 8 KB on sync; a large holdings list can exceed it.
    // Local has a much larger budget and no sync, which is the right trade when
    // the alternative is losing the edit.
    await browserApi.storage.local.set({ [KEY]: next });
    return 'local';
  }
}
