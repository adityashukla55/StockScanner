/**
 * Settings, read once at startup.
 *
 * The web app took these from environment variables the server owned. Here
 * there is no server and no deployment — each install is one person's — so they
 * come from extension storage, with the same defaults.
 *
 * Read synchronously from a cached snapshot: the data modules are plain
 * functions that used to read `process.env` inline, and threading a promise
 * through all of them to fetch a number would be a poor trade. `load()` runs
 * before React mounts.
 */
import { browserApi } from './browser.js';
const DEFAULTS = {
  // Solo use against your own connection: no shared deployment to protect, so
  // this is the value the web app used locally rather than the deployed one.
  quoteCacheSeconds: 5,
  pollSeconds: 15,
  // Which market search offers and the header clock reads. 'all' is everything.
  market: 'all',
  // 'yahoo' keeps implied volatility; 'off' drops it for historical volatility.
  optionsProvider: 'yahoo',
  theme: null,
};

let current = { ...DEFAULTS };

export const settings = () => current;

export async function load() {
  try {
    const stored = await browserApi.storage.sync.get('settings');
    current = { ...DEFAULTS, ...(stored?.settings ?? {}) };
  } catch {
    current = { ...DEFAULTS }; // First run, or storage unavailable.
  }
  return current;
}

export async function save(patch) {
  current = { ...current, ...patch };
  try {
    await browserApi.storage.sync.set({ settings: current });
  } catch {
    // Nothing to fall back to; the in-memory value still applies this session.
  }
  return current;
}
