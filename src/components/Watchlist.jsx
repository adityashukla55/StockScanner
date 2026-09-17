import { money, signedPct } from '../format.js';

/** Clicking a row does something different per view, so say which. */
const ROW_LABEL = {
  detail: (s) => `Open ${s}`,
  compare: (s) => `Toggle ${s} in the comparison`,
  portfolio: (s) => `Add ${s} to the portfolio`,
  projection: (s) => `Project ${s}`,
  allocation: (s) => `Toggle ${s} in the allocation`,
};

export default function Watchlist({ symbols, quotes, selected, compared = [], mode, onSelect, onRemove }) {
  const comparing = mode === 'compare';
  const label = ROW_LABEL[mode] ?? ROW_LABEL.detail;

  return (
    <aside className="watchlist">
      <div className="panel-head">
        <h2>Watchlist</h2>
        <span className="count">{symbols.length}</span>
      </div>

      {symbols.length === 0 && (
        <p className="watchlist-empty">
          Search above and pick a ticker to pin it here. Quotes refresh automatically.
        </p>
      )}

      <ul className="watchlist-rows">
        {symbols.map((symbol) => {
          const q = quotes[symbol];
          const dir = q?.changePercent > 0 ? 'up' : q?.changePercent < 0 ? 'down' : 'flat';
          const isCompared = compared.includes(symbol);
          const isActive = symbol === selected || isCompared;

          return (
            <li key={symbol}>
              <button
                type="button"
                className={`watch-row ${isActive ? 'selected' : ''}`}
                onClick={() => onSelect(symbol)}
                aria-pressed={comparing ? isCompared : undefined}
                title={label(symbol)}
              >
                <span className="watch-id">
                  <span className="ticker">{symbol}</span>
                  <span className="co-name">{q?.name ?? '…'}</span>
                </span>
                <span className="watch-price">
                  <span className="px">{q ? money(q.price, q.currency) : '—'}</span>
                  <span className={`chg ${dir}`}>{q ? signedPct(q.changePercent) : ''}</span>
                </span>
              </button>
              <button
                type="button"
                className="remove"
                onClick={() => onRemove(symbol)}
                aria-label={`Remove ${symbol} from watchlist`}
                title={`Remove ${symbol}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
