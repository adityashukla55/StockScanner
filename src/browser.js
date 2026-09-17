/**
 * The extension API namespace, whichever browser this is.
 *
 * Firefox implements the standard `browser.*` namespace, where every method
 * returns a promise, and keeps a `chrome.*` alias for compatibility whose
 * promise support is not something to rely on. Chrome implements only
 * `chrome.*`, which does return promises under Manifest V3.
 *
 * Preferring `browser` and falling back to `chrome` therefore gets promises on
 * both, and lets the rest of the code be written once with plain `await`.
 */
/**
 * Enough of the extension API for the dev server to run against.
 *
 * Only reached on localhost, where neither namespace exists. Storage falls back
 * to localStorage, which is the wrong answer for a real install — it is
 * per-origin and per-device — but exactly right for a throwaway dev session.
 */
function devShim() {
  const area = (prefix) => ({
    get: async (key) => {
      try {
        const raw = localStorage.getItem(prefix + key);
        return raw ? { [key]: JSON.parse(raw) } : {};
      } catch {
        return {};
      }
    },
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) {
        try {
          localStorage.setItem(prefix + k, JSON.stringify(v));
        } catch {
          /* Quota or private mode: the session simply does not persist. */
        }
      }
    },
    remove: async (key) => localStorage.removeItem(prefix + key),
  });

  return {
    storage: { sync: area('dev:sync:'), local: area('dev:local:'), session: area('dev:session:') },
    runtime: { getManifest: () => ({ host_permissions: [] }), getURL: (p) => '/' + p },
    permissions: { contains: async () => true, request: async () => true },
    tabs: { query: async () => [], create: async () => ({}), update: async () => ({}) },
  };
}

/**
 * Chrome defines a stub `window.chrome` on ordinary pages too — it carries
 * things like `loadTimes` and none of the extension APIs. Testing for the
 * namespace therefore finds an object that exists and cannot do anything, so
 * the test is for `storage`, which only a real extension context has.
 */
const native = globalThis.browser ?? globalThis.chrome;

/**
 * The shim is reachable only from a dev branch, so the bundler drops it — and
 * with it every `localStorage` call it contains.
 *
 * That is worth arranging deliberately. A runtime `native ?? devShim()` would
 * have kept the fallback in the shipped file, leaving an extension that
 * advertises `storage` as its only permission carrying unreachable code that
 * writes to browser storage by another route. Reviewers read the source, and
 * they would be right to ask.
 */
export const browserApi =
  native?.storage ? native : typeof __DEV_PROXY__ !== 'undefined' && __DEV_PROXY__ ? devShim() : native;
