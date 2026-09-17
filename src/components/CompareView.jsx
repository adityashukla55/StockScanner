import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchCompare } from '../api.js';
import { axisLabel, money, signedPct, tooltipLabel, typeLabel } from '../format.js';
import RangePicker from './RangePicker.jsx';
import InfoTip from './InfoTip.jsx';

/** Distinguishable in both themes, and colour-blind safe enough for 8 series. */
export const SERIES_COLORS = [
  '#c96442',
  '#3b82c4',
  '#2f9e6e',
  '#9b72cf',
  '#d9a441',
  '#c4568c',
  '#4fa3a5',
  '#7d8a99',
];

function CompareTooltip({ active, payload, label, range, colors }) {
  if (!active || !payload?.length) return null;
  const rows = [...payload]
    .filter((p) => p.value != null)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="chart-tip">
      <div className="chart-tip-date">{tooltipLabel(label, range)}</div>
      <ul className="tip-rows">
        {rows.map((r) => (
          <li key={r.dataKey}>
            <span className="tip-dot" style={{ background: colors[r.dataKey] }} />
            <span className="tip-sym">{r.dataKey}</span>
            <span className={`tip-val ${r.value >= 0 ? 'up' : 'down'}`}>{signedPct(r.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CompareView({ symbols, onToggle, onClear, watchlist }) {
  const [range, setRange] = useState('1y');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!symbols.length) {
      setData(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchCompare(symbols, range, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [symbols, range]);

  const series = data?.series ?? [];
  const colors = Object.fromEntries(
    series.map((s, i) => [s.symbol, SERIES_COLORS[i % SERIES_COLORS.length]]),
  );
  const ranked = [...series].sort((a, b) => (b.periodReturn ?? -Infinity) - (a.periodReturn ?? -Infinity));

  // Everything the user can add without searching: watchlist plus what's charted.
  const candidates = [...new Set([...watchlist, ...symbols])];

  return (
    <section className="detail compare">
      <header className="compare-head">
        <div>
          <h2>
            Compare
            <InfoTip label="What the Compare tab shows">
              <p>
                Every line is <strong>rebased to 0%</strong> at its first candle inside the
                range, so the chart reads as relative performance rather than unrelated share
                prices.
              </p>
              <span className="formula">value = (close ÷ first close − 1) × 100</span>
              <p>
                Closes are adjusted for splits and dividends. A ticker that listed partway
                through starts from its own first day, and the last known close is carried
                across any day it did not trade — so a trading holiday on one exchange does not
                punch a hole in the others.
              </p>
              <p className="caveat">
                Percentages are comparable across currencies; the price column beside them is
                not, and stays in each exchange's own unit.
              </p>
            </InfoTip>
          </h2>
        </div>
        {symbols.length > 0 && (
          <button type="button" className="ghost-btn" onClick={onClear}>
            Clear all
          </button>
        )}
      </header>

      <div className="chips">
        {candidates.map((symbol) => {
          const on = symbols.includes(symbol);
          return (
            <button
              key={symbol}
              type="button"
              className={`chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => onToggle(symbol)}
              style={on ? { '--chip': colors[symbol] ?? 'var(--accent)' } : undefined}
            >
              {on && <span className="chip-dot" />}
              {symbol}
            </button>
          );
        })}
        <span className="chips-hint">
          {symbols.length >= 8
            ? 'Maximum of 8 at once'
            : 'Search above to add any other ticker'}
        </span>
      </div>

      <RangePicker value={range} onChange={setRange} />

      {symbols.length === 0 ? (
        <div className="chart-placeholder">Pick at least one ticker to compare.</div>
      ) : error ? (
        <div className="chart-placeholder error">{error}</div>
      ) : !data && loading ? (
        <div className="chart-placeholder">Loading comparison…</div>
      ) : (
        <div className={`chart-wrap ${loading ? 'is-stale' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.rows ?? []} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t) => axisLabel(t, range)}
                tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--grid)' }}
                tickLine={false}
                minTickGap={44}
              />
              <YAxis
                orientation="right"
                width={64}
                tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke="var(--text-dim)" strokeOpacity={0.55} />
              <Tooltip
                content={<CompareTooltip range={range} colors={colors} />}
                cursor={{ stroke: 'var(--text-dim)', strokeDasharray: '3 3' }}
              />
              {series.map((s) => (
                <Line
                  key={s.symbol}
                  type="monotone"
                  dataKey={s.symbol}
                  stroke={colors[s.symbol]}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 0 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {data?.failed?.length > 0 && (
        <p className="compare-warn">Could not load: {data.failed.join(', ')}</p>
      )}

      {ranked.length > 0 && (
        <table className="compare-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="hide-sm">Name</th>
              <th>Price</th>
              <th>Today</th>
              <th>Over range</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => (
              <tr key={s.symbol}>
                <td>
                  <span className="tip-dot" style={{ background: colors[s.symbol] }} />
                  <span className="ticker">{s.symbol}</span>
                  <span className={`badge ${s.type?.toLowerCase()}`}>{typeLabel(s.type)}</span>
                </td>
                <td className="hide-sm co-name">{s.name}</td>
                <td className="num">{money(s.price, s.currency)}</td>
                <td className={`num ${s.changePercent >= 0 ? 'up' : 'down'}`}>
                  {signedPct(s.changePercent)}
                </td>
                <td className={`num strong ${s.periodReturn >= 0 ? 'up' : 'down'}`}>
                  {signedPct(s.periodReturn)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
