import { MARKETS, marketFor } from '../markets.js';

/**
 * Which market the app is following.
 *
 * Changes what search offers and whose trading hours the header reads. It
 * changes nothing about what you already hold: a watchlist assembled across
 * three exchanges keeps working whatever is selected here, because this filters
 * discovery rather than data. Switching it is always reversible, and 'All
 * markets' puts everything back.
 */
export default function MarketPicker({ value, onChange }) {
  const current = marketFor(value);

  return (
    <label className="market-picker" title="Which market to search and follow">
      <span className="market-flag" aria-hidden="true">{current.flag}</span>
      <select
        value={current.key}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Market to follow"
      >
        {MARKETS.map((market) => (
          <option key={market.key} value={market.key}>
            {market.label}
          </option>
        ))}
      </select>
    </label>
  );
}
