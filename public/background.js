/**
 * The toolbar button opens the dashboard in a tab.
 *
 * There is no default_popup in the manifest, so this handler is what the button
 * does. A popup is capped at 800x600 and dismisses the moment you click away —
 * the wrong shape for charts you want to sit with. A tab gives the layout its
 * full width and stays put.
 *
 * Reusing the open tab rather than stacking copies would normally mean
 * chrome.tabs.query({url}), which needs the "tabs" permission — the one that
 * reads to a user as "read your browsing history". Remembering the id instead
 * costs one storage write and keeps the permission list to storage alone.
 */
// Firefox implements browser.* with promises and keeps a chrome.* alias whose
// promise support is not to be relied on; Chrome implements only chrome.*,
// which does return promises under MV3. Preferring browser gets promises on
// both, so the awaits below work either way.
const api = globalThis.browser ?? globalThis.chrome;

const PAGE = 'index.html';
const TAB_KEY = 'dashboardTabId';

async function existingTab() {
  try {
    const { [TAB_KEY]: id } = await api.storage.session.get(TAB_KEY);
    if (typeof id !== 'number') return null;
    // Throws if the tab was closed since we noted it.
    return await api.tabs.get(id);
  } catch {
    return null;
  }
}

api.action.onClicked.addListener(async () => {
  const open = await existingTab();

  if (open) {
    await api.tabs.update(open.id, { active: true });
    await api.windows.update(open.windowId, { focused: true });
    return;
  }

  const tab = await api.tabs.create({ url: api.runtime.getURL(PAGE) });
  await api.storage.session.set({ [TAB_KEY]: tab.id });
});

// Forget a closed tab, so the next click opens a fresh one rather than failing
// its way there.
api.tabs.onRemoved.addListener(async (tabId) => {
  const { [TAB_KEY]: id } = await api.storage.session.get(TAB_KEY);
  if (id === tabId) await api.storage.session.remove(TAB_KEY);
});
