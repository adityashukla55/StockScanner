import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchQuotes, fetchState, saveState } from './api.js';
import { marketStatus } from './format.js';
import { marketFor } from './markets.js';
import MarketPicker from './components/MarketPicker.jsx';
import AllocationView from './components/AllocationView.jsx';
import BackupPanel from './components/BackupPanel.jsx';
import CompareView from './components/CompareView.jsx';
import PortfolioView from './components/PortfolioView.jsx';
import ProjectionView from './components/ProjectionView.jsx';
import SearchBar from './components/SearchBar.jsx';
import StockDetail from './components/StockDetail.jsx';
import Watchlist from './components/Watchlist.jsx';
import { save, settings } from './settings.js';
import { addMissing, newGroupId, uniqueGroupName } from './groups.js';
import { SPONSOR, sponsorConfigured } from './links.js';

/**
 * Your setup lives in extension storage: read once on load, written back on
 * every change, and synced to any browser profile you are signed into.
 *
 * It is the only copy. Nothing is sent anywhere, and no server has ever seen it
 * — see src/storage.js for why sync is preferred and when it falls back.
 */

/**
 * Where the pre-paint theme is mirrored.
 *
 * Must match public/theme-boot.js, which reads it before React exists and
 * cannot import from here — it is a classic script, deliberately, so that it
 * runs during parse and beats the first paint.
 */
const THEME_KEY = 'stock-scanner:theme';

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'VOO'];
const MAX_COMPARE = 8;
// How often quotes refresh, from settings. Yahoo is free, so this is about
// being a good guest rather than a budget.
const POLL_MS = 1000 * Math.max(5, Number(settings().pollSeconds) || 15);
const SAVE_DEBOUNCE_MS = 400;
const RETRY_MS = 4_000;

/** What clicking a watchlist row does, per view. */
const WATCHLIST_ACTIONS = {
  detail: ({ setSelected }) => setSelected,
  compare: ({ toggleCompare }) => toggleCompare,
  portfolio: ({ addHolding }) => addHolding,
  projection: ({ setProjectionSymbol }) => setProjectionSymbol,
  allocation: ({ togglePick }) => togglePick,
};

export default function App() {
  const [symbols, setSymbols] = useState(DEFAULT_WATCHLIST);
  const [compareSymbols, setCompareSymbols] = useState(() => DEFAULT_WATCHLIST.slice(0, 3));
  const [selected, setSelected] = useState(DEFAULT_WATCHLIST[0]);
  const [holdings, setHoldings] = useState([]);
  const [projectionSymbol, setProjectionSymbol] = useState(DEFAULT_WATCHLIST[0]);
  const [picks, setPicks] = useState(() => DEFAULT_WATCHLIST.slice(0, 4));
  const [view, setView] = useState('detail');
  const [theme, setTheme] = useState('light');
  const [saveStatus, setSaveStatus] = useState('saved');
  const [quotes, setQuotes] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const [live, setLive] = useState(true);
  const [market, setMarket] = useState(() => settings().market ?? 'all');
  const [status, setStatus] = useState(() => marketStatus());
  const [refreshKey, setRefreshKey] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [storedIn, setStoredIn] = useState(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [undo, setUndo] = useState(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const pool = useMemo(() => (activeGroup ? activeGroup.symbols : symbols), [activeGroup, symbols]);
  const visibleHoldings = useMemo(
    () => (activeGroup ? holdings.filter((h) => activeGroup.symbols.includes(h.symbol)) : holdings),
    [activeGroup, holdings],
  );
  /**
   * Whose trading day the header is describing.
   *
   * The app was US-only, so 'open' could only ever mean New York. With German
   * and Indian listings in the same watchlist that is no longer a safe default,
   * so the header follows the exchange behind the selected ticker. Yahoo reports
   * the zone on every quote, which is what makes this work without a table of
   * exchange codes.
   */
  const zone = marketFor(market).zone ?? (selected ? quotes[selected]?.timezone : undefined);

  const chooseMarket = useCallback((key) => {
    setMarket(key);
    save({ market: key });
  }, []);

  const inFlight = useRef(null);
  const saveTimer = useRef(null);
  const pending = useRef(null);

  /**
   * Drop theme mirrors left by earlier names of this app.
   *
   * The pre-paint theme is kept in localStorage under a key carrying the app's
   * name, so every rename strands the previous one. Matching on the suffix
   * rather than a list of old names means the next rename cleans up after
   * itself too.
   *
   * It only ever touches this extension's own storage — an extension origin is
   * its own, and nothing here can see what a website stored.
   */
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.endsWith(':theme') && key !== THEME_KEY) localStorage.removeItem(key);
      }
    } catch {
      // Storage may be unavailable entirely, which is the desired end state.
    }
  }, []);

  const applyState = useCallback((state) => {
    if (state.watchlist) setSymbols(state.watchlist);
    if (state.compare) setCompareSymbols(state.compare);
    if (state.holdings) setHoldings(state.holdings);
    if (state.picks) setPicks(state.picks);
    if (state.theme) setTheme(state.theme);
    if (state.groups) setGroups(state.groups);
    setActiveGroupId(state.activeGroup ?? null);
    const first =
      state.groups?.find((g) => g.id === state.activeGroup)?.symbols[0] ?? state.watchlist?.[0];
    if (first) {
      setSelected(first);
      setProjectionSymbol(first);
    }
  }, []);

  /** Load the saved setup before showing anything, so defaults never look like data loss. */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const state = await fetchState();
        if (!cancelled && state.exists) applyState(state);
      } catch (err) {
        console.error('Could not load saved state:', err.message);
      }
      if (!cancelled) setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyState]);

  /**
   * Write every change back to storage, debounced.
   *
   * A failed write is retried until it lands rather than logged and forgotten.
   * Storage rarely fails, but when it does it is usually the sync quota, and
   * the edit that tripped it is exactly the one worth not losing — storage.js
   * falls back to local, so the retry has somewhere to succeed.
   */
  useEffect(() => {
    if (!hydrated) return undefined;

    const payload = {
      watchlist: symbols,
      compare: compareSymbols,
      holdings,
      theme,
      picks,
      groups,
      activeGroup: activeGroupId,
    };
    pending.current = payload;
    setSaveStatus('saving');

    const attempt = () => {
      saveState(payload)
        .then((area) => {
          if (pending.current !== payload) return; // Superseded by a newer edit.
          pending.current = null;
          setSaveStatus('saved');
          setStoredIn(area);
        })
        .catch(() => {
          if (pending.current !== payload) return;
          setSaveStatus('unsaved');
          saveTimer.current = setTimeout(attempt, RETRY_MS);
        });
    };

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(attempt, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(saveTimer.current);
  }, [hydrated, symbols, compareSymbols, holdings, theme, picks, groups, activeGroupId]);

  /**
   * Flush an unsaved edit when the page goes away.
   *
   * Without this, typing a value and closing the tab inside the 400 ms debounce
   * window loses it.
   *
   * This used to post the payload to `/api/state` with `navigator.sendBeacon`,
   * which was right when a server owned the data and became silently useless
   * when one stopped existing: in an extension page that path resolves to
   * `chrome-extension://<id>/api/state`, nothing answers it, and the beacon
   * reports success for having queued the request. The safety net was gone
   * while still looking present.
   *
   * Writing to storage directly is what works here. The call is handed to the
   * browser process, which outlives this page — the same property sendBeacon
   * was chosen for.
   */
  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      const payload = pending.current;
      pending.current = null;
      // Deliberately not awaited: there may be no next tick to await in.
      saveState(payload).catch(() => {
        pending.current = payload; // Still unsaved if the page survives after all.
      });
    };

    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Mirrored for theme-boot.js, which runs before React and cannot await
    // chrome.storage. Losing it costs a flash, not a setting.
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  // Every symbol we need a quote for: the watchlist, the open ticker, whatever
  // is charted in the comparison, and every position held in the portfolio.
  const tracked = useMemo(
    () => [
      ...new Set(
        [...symbols, selected, ...compareSymbols, ...holdings.map((h) => h.symbol)].filter(Boolean),
      ),
    ],
    [symbols, selected, compareSymbols, holdings],
  );

  const refresh = useCallback(async () => {
    if (!tracked.length) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const list = await fetchQuotes(tracked, controller.signal);
      setQuotes((prev) => {
        const next = { ...prev };
        for (const q of list) next[q.symbol] = q;
        return next;
      });
      setUpdatedAt(Date.now());
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Quote refresh failed:', err.message);
    }
  }, [tracked]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setStatus(marketStatus(new Date(), zone));
  }, [zone]);

  useEffect(() => {
    if (!live) return undefined;
    const tick = () => {
      // Don't burn requests while the tab is hidden.
      if (document.visibilityState !== 'visible') return;
      setStatus(marketStatus(new Date(), zone));
      refresh();
      setRefreshKey((k) => k + 1);
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh, zone]);

  const toggleCompare = useCallback(
    (symbol) =>
      setCompareSymbols((prev) =>
        prev.includes(symbol)
          ? prev.filter((s) => s !== symbol)
          : prev.length >= MAX_COMPARE
            ? prev
            : [...prev, symbol],
      ),
    [],
  );

  const addToGroup = useCallback((id, list) => {
    setGroups((prev) => {
      const group = prev.find((g) => g.id === id);
      if (!group) return prev;
      const next = addMissing(group.symbols, list);
      return next === group.symbols ? prev : prev.map((g) => (g.id === id ? { ...g, symbols: next } : g));
    });
    setSymbols((prev) => addMissing(prev, list));
  }, []);

  const dropFromGroups = (symbol, onlyId = null) =>
    setGroups((prev) =>
      prev.map((g) =>
        (onlyId == null || g.id === onlyId) && g.symbols.includes(symbol)
          ? { ...g, symbols: g.symbols.filter((s) => s !== symbol) }
          : g,
      ),
    );

  const addHolding = useCallback(
    (symbol) => {
      setHoldings((prev) =>
        prev.some((h) => h.symbol === symbol) ? prev : [...prev, { symbol, invested: '', fee: '', buy: '' }],
      );
      if (activeGroupId) addToGroup(activeGroupId, [symbol]);
    },
    [activeGroupId, addToGroup],
  );

  const updateHolding = (symbol, patch) =>
    setHoldings((prev) => prev.map((h) => (h.symbol === symbol ? { ...h, ...patch } : h)));

  const togglePick = useCallback(
    (symbol) =>
      setPicks((prev) =>
        prev.includes(symbol)
          ? prev.filter((s) => s !== symbol)
          : prev.length >= 8
            ? prev
            : [...prev, symbol],
      ),
    [],
  );

  const removeHolding = (symbol) =>
    setHoldings((prev) => prev.filter((h) => h.symbol !== symbol));

  /** A search hit means "use this ticker" — which depends on the view you're in. */
  const handleSearchSelect = (symbol) => {
    const ticker = symbol.toUpperCase();
    if (view === 'compare') {
      setCompareSymbols((prev) =>
        prev.includes(ticker) || prev.length >= MAX_COMPARE ? prev : [...prev, ticker],
      );
    } else if (view === 'portfolio') {
      addHolding(ticker);
    } else if (view === 'projection') {
      setProjectionSymbol(ticker);
    } else if (view === 'allocation') {
      togglePick(ticker);
    } else {
      setSelected(ticker);
    }
  };

  const remove = (symbol) => {
    if (activeGroup) {
      dropFromGroups(symbol, activeGroup.id);
      return;
    }
    dropFromGroups(symbol);
    setSymbols((prev) => {
      const next = prev.filter((s) => s !== symbol);
      if (symbol === selected) setSelected(next[0] ?? null);
      return next;
    });
  };

  const toggleWatch = (symbol) => {
    if (pool.includes(symbol)) {
      if (activeGroup) dropFromGroups(symbol, activeGroup.id);
      else {
        dropFromGroups(symbol);
        setSymbols((prev) => prev.filter((s) => s !== symbol));
      }
    } else if (activeGroup) {
      addToGroup(activeGroup.id, [symbol]);
    } else {
      setSymbols((prev) => addMissing(prev, [symbol]));
    }
  };

  const alignTo = (members) => {
    if (!members.length) return;
    if (!members.includes(selected)) setSelected(members[0]);
    if (!members.includes(projectionSymbol)) setProjectionSymbol(members[0]);
  };

  const pickGroup = (id) => {
    setActiveGroupId(id);
    alignTo(groups.find((g) => g.id === id)?.symbols ?? []);
  };

  const createGroup = () => {
    const id = newGroupId();
    setGroups((prev) => [...prev, { id, name: uniqueGroupName(prev), symbols: [] }]);
    setActiveGroupId(id);
  };

  const renameGroup = (id, name) =>
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));

  const finishGroup = (id) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, name: g.name.trim() || uniqueGroupName(prev, 'Group') } : g)),
    );
    if (id === activeGroupId) alignTo(groups.find((g) => g.id === id)?.symbols ?? []);
  };

  const deleteGroup = (id) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setActiveGroupId(null);
  };

  const toggleMember = (id, symbol) => {
    if (groups.find((g) => g.id === id)?.symbols.includes(symbol)) dropFromGroups(symbol, id);
    else addToGroup(id, [symbol]);
  };

  const groupCandidates = useMemo(
    () => addMissing(symbols, holdings.map((h) => h.symbol)),
    [symbols, holdings],
  );

  const currentState = () => ({
    watchlist: symbols,
    compare: compareSymbols,
    holdings,
    picks,
    theme,
    groups,
    activeGroup: activeGroupId,
  });

  const importBackup = ({ state, settings: imported }) => {
    setUndo({ state: currentState(), market });
    applyState(state);
    if (imported?.market) chooseMarket(imported.market);
  };

  const undoImport = () => {
    if (!undo) return;
    applyState(undo.state);
    chooseMarket(undo.market);
    setUndo(null);
  };

  // Extension storage is fast but asynchronous, so there is a frame or two
  // before a setup arrives. Showing the defaults in that gap would look like
  // data loss, which is worth a flicker to avoid.
  if (!hydrated) {
    return (
      <div className="app">
        <div className="booting">Loading your setup…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17.5 9 11l4 4 7.5-8" />
              <path d="M15 7h6v6" />
            </svg>
          </span>
          <div>
            <h1>Stock Scanner</h1>
            <p>Stocks &amp; ETFs worldwide · quotes, history, portfolio and projections</p>
          </div>
        </div>

        <SearchBar onSelect={handleSearchSelect} market={market} />

        <div className="status">
          <MarketPicker value={market} onChange={chooseMarket} />
          <span className={`dot ${status.open ? 'open' : 'closed'}`} />
          <span className="status-label">{status.label}</span>
          <button
            type="button"
            className={`live-toggle ${live ? 'on' : ''}`}
            onClick={() => setLive((v) => !v)}
            title={live ? 'Pause auto-refresh' : 'Resume auto-refresh'}
          >
            {live ? 'Live' : 'Paused'}
          </button>
          <span className="updated">
            {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString('en-US')}` : 'Loading…'}
          </span>
          {saveStatus === 'unsaved' && (
            <span
              className="save-state"
              title="Your last change has not been stored yet. Retrying."
            >
              ● Unsaved
            </span>
          )}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
        </div>
      </header>

      <nav className="views" aria-label="View">
        <button type="button" className={view === 'detail' ? 'on' : ''} onClick={() => setView('detail')}>
          Detail
        </button>
        <button type="button" className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>
          Compare
          {compareSymbols.length > 0 && <span className="pill">{compareSymbols.length}</span>}
        </button>
        <button
          type="button"
          className={view === 'portfolio' ? 'on' : ''}
          onClick={() => setView('portfolio')}
        >
          Portfolio
          {holdings.length > 0 && <span className="pill">{holdings.length}</span>}
        </button>
        <button
          type="button"
          className={view === 'projection' ? 'on' : ''}
          onClick={() => setView('projection')}
        >
          Projection
        </button>
        <button
          type="button"
          className={view === 'allocation' ? 'on' : ''}
          onClick={() => setView('allocation')}
        >
          Allocation
          {picks.length > 0 && <span className="pill">{picks.length}</span>}
        </button>
        <button
          type="button"
          className="views-backup"
          onClick={() => setBackupOpen(true)}
          title="Save your setup to a file, or load it on another computer"
        >
          ⇅ Backup &amp; move
        </button>
      </nav>

      <main className="layout">
        <Watchlist
          symbols={pool}
          total={symbols.length}
          groups={groups}
          activeGroup={activeGroup}
          candidates={groupCandidates}
          onPickGroup={pickGroup}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onFinishGroup={finishGroup}
          onDeleteGroup={deleteGroup}
          onToggleMember={toggleMember}
          onAddMembers={addToGroup}
          quotes={quotes}
          selected={view === 'detail' ? selected : view === 'projection' ? projectionSymbol : null}
          compared={
            view === 'compare'
              ? compareSymbols
              : view === 'portfolio'
                ? holdings.map((h) => h.symbol)
                : view === 'allocation'
                  ? picks
                  : []
          }
          mode={view}
          onSelect={WATCHLIST_ACTIONS[view]({
            setSelected,
            toggleCompare,
            addHolding,
            setProjectionSymbol,
            togglePick,
          })}
          onRemove={remove}
        />

        {view === 'detail' && (
          <StockDetail
            symbol={selected}
            quote={selected ? quotes[selected] : null}
            inWatchlist={pool.includes(selected)}
            listName={activeGroup?.name}
            onToggleWatch={toggleWatch}
            onSelectSymbol={setSelected}
            refreshKey={refreshKey}
          />
        )}
        {view === 'compare' && (
          <CompareView
            symbols={compareSymbols}
            watchlist={pool}
            group={activeGroup}
            onUseGroup={() => setCompareSymbols(pool.slice(0, MAX_COMPARE))}
            onToggle={toggleCompare}
            onClear={() => setCompareSymbols([])}
          />
        )}
        {view === 'portfolio' && (
          <PortfolioView
            holdings={visibleHoldings}
            hiddenCount={holdings.length - visibleHoldings.length}
            groupName={activeGroup?.name}
            quotes={quotes}
            onUpdate={updateHolding}
            onRemove={removeHolding}
          />
        )}
        {view === 'projection' && (
          <ProjectionView
            symbol={projectionSymbol}
            watchlist={pool}
            groupName={activeGroup?.name}
            onPickSymbol={setProjectionSymbol}
          />
        )}
        {view === 'allocation' && (
          <AllocationView
            watchlist={pool}
            group={activeGroup}
            onUseGroup={() => setPicks(pool.slice(0, 8))}
            picks={picks}
            onPicksChange={setPicks}
          />
        )}
      </main>

      <footer className="foot">
        <span>
          <strong>For information only.</strong> Nothing here is a promise about the future.
          Every projection is arithmetic over prices that have already happened — it describes
          possibilities the maths allows, not outcomes anyone expects. Data from Yahoo Finance,
          for personal use, delayed up to 15 minutes. Not investment advice.
        </span>
        {sponsorConfigured() && (
          <a className="sponsor" href={SPONSOR} target="_blank" rel="noreferrer noopener">
            ☕ Buy me a coffee
          </a>
        )}
      </footer>

      {backupOpen && (
        <BackupPanel
          current={currentState()}
          settings={{ market }}
          storedIn={storedIn}
          canUndo={undo != null}
          onApply={importBackup}
          onUndo={undoImport}
          onClose={() => setBackupOpen(false)}
        />
      )}
    </div>
  );
}
