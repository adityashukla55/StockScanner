import { useEffect, useRef, useState } from 'react';
import { searchSymbols } from '../api.js';
import { inMarket, marketFor } from '../markets.js';
import { typeLabel } from '../format.js';

export default function SearchBar({ onSelect, market = 'all' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    // Debounce so typing a ticker doesn't fire a request per keystroke.
    const timer = setTimeout(() => {
      setLoading(true);
      searchSymbols(term, controller.signal)
        .then((r) => {
          setResults(r.filter((item) => inMarket(item.symbol, market)));
          setActive(0);
          setOpen(true);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setResults([]);
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, market]);

  useEffect(() => {
    const onClickAway = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  function choose(item) {
    onSelect(item.symbol);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="search" ref={boxRef}>
      <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input
        type="text"
        value={query}
        placeholder="Search stocks & ETFs — try AAPL, Vanguard, semiconductor…"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search stocks and ETFs"
        autoComplete="off"
      />
      {loading && <span className="search-spinner" aria-hidden="true" />}

      {open && results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((item, i) => (
            <li
              key={item.symbol}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
            >
              <span className="ticker">{item.symbol}</span>
              <span className="co-name">{item.name}</span>
              <span className={`badge ${item.type.toLowerCase()}`}>{typeLabel(item.type)}</span>
              <span className="exch">{item.exchange}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && query.trim() && results.length === 0 && (
        <ul className="search-results">
          <li className="empty">
              No stocks or ETFs match “{query.trim()}”
              {market !== 'all' && <> on {marketFor(market).label} — switch to All markets to widen the search</>}.
            </li>
        </ul>
      )}
    </div>
  );
}
