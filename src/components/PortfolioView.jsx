import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { compact, money, signedMoney, signedPct } from '../format.js';
import { SERIES_COLORS } from './CompareView.jsx';
import InfoTip from './InfoTip.jsx';

const num = (value) => {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export default function PortfolioView({ holdings, hiddenCount = 0, groupName, quotes, onUpdate, onRemove }) {
  const rows = useMemo(
    () =>
      holdings.map((h, i) => {
        const quote = quotes[h.symbol];
        const shares = num(h.shares);
        const costPerShare = num(h.cost);
        const price = quote?.price ?? null;

        const value = price != null ? shares * price : null;
        const dayChange = quote?.change != null ? shares * quote.change : null;
        const costTotal = costPerShare > 0 ? shares * costPerShare : null;
        const gain = value != null && costTotal != null ? value - costTotal : null;

        return {
          symbol: h.symbol,
          // Keep what the user typed verbatim so a half-entered "1." or a
          // cleared field doesn't get rewritten under the cursor.
          sharesRaw: h.shares ?? '',
          costRaw: h.cost ?? '',
          shares,
          costPerShare,
          name: quote?.name ?? h.symbol,
          currency: quote?.currency ?? null,
          price,
          value,
          dayChange,
          costTotal,
          gain,
          gainPct: gain != null && costTotal ? (gain / costTotal) * 100 : null,
          color: SERIES_COLORS[i % SERIES_COLORS.length],
        };
      }),
    [holdings, quotes],
  );

  /**
   * One set of totals per currency.
   *
   * A portfolio can now hold SAP in euros and Reliance in rupees, and adding
   * those together produces a number that means nothing. Rather than invent an
   * exchange rate — which would be one more thing to go stale and be wrong
   * about — each currency is summed on its own and shown beside the others.
   */
  const groups = useMemo(() => {
    const byCurrency = new Map();

    for (const r of rows) {
      if (r.value == null && r.costTotal == null) continue;
      const key = r.currency ?? 'USD';
      if (!byCurrency.has(key)) byCurrency.set(key, []);
      byCurrency.get(key).push(r);
    }

    return [...byCurrency.entries()]
      .map(([currency, members]) => {
        const value = members.reduce((sum, r) => sum + (r.value ?? 0), 0);
        const dayChange = members.reduce((sum, r) => sum + (r.dayChange ?? 0), 0);
        // Only holdings with a cost basis contribute to the gain figure, so a
        // half-filled portfolio doesn't report a misleading total return.
        const priced = members.filter((r) => r.costTotal != null && r.value != null);
        const cost = priced.reduce((sum, r) => sum + r.costTotal, 0);
        const invested = priced.reduce((sum, r) => sum + r.value, 0);

        return {
          currency,
          rows: members,
          value,
          dayChange,
          dayChangePct: value - dayChange ? (dayChange / (value - dayChange)) * 100 : null,
          cost,
          gain: priced.length ? invested - cost : null,
          gainPct: priced.length && cost ? ((invested - cost) / cost) * 100 : null,
          partialBasis: priced.length > 0 && priced.length < members.length,
          allocation: members
            .filter((r) => (r.value ?? 0) > 0)
            .map((r) => ({ name: r.symbol, value: r.value, color: r.color })),
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const mixed = groups.length > 1;

  /** A holding's weight is a share of its own currency's total, not of a mixed sum. */
  const weightBase = (row) => groups.find((g) => g.currency === (row.currency ?? 'USD'))?.value ?? 0;

  return (
    <section className="detail portfolio">
      <header className="compare-head">
        <div>
          <h2>
            Portfolio
            <InfoTip label="What the Portfolio tab computes">
              <p>
                Value and return come straight from what you enter, with no modelling in
                between:
              </p>
              <span className="formula">
                value = shares × price    gain = value − shares × cost
              </span>
              <p>
                The statistics underneath are the ones that only exist <em>across</em> holdings.
                They are computed on <strong>daily simple returns</strong> over the lookback —
                simple rather than log, because a portfolio's return is the weighted sum of its
                holdings' simple returns and weighting log returns would be quietly wrong.
                Covariance uses the sample estimator (n−1) and is annualised by the number of
                observations actually sampled, not an assumed 252.
              </p>
              <p className="caveat">
                Holdings in different currencies are totalled separately. Nothing here converts
                between them. Correlation and volatility are unaffected, since both are computed
                from returns rather than prices.
              </p>
            </InfoTip>
          </h2>
        </div>
      </header>

      {groupName && (
        <p className="group-filter-note">
          Showing only the group <strong>{groupName}</strong>
          {hiddenCount > 0 &&
            ` · ${hiddenCount} other ${hiddenCount === 1 ? 'holding is' : 'holdings are'} hidden`}
          . Pick <em>All</em> in the watchlist to see everything.
        </p>
      )}

      {holdings.length === 0 ? (
        <div className="chart-placeholder">
          {groupName
            ? `No holdings in ${groupName} yet. Search above to add one — it joins this group too.`
            : 'Search for a ticker above to add your first holding.'}
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <div className="totals" key={g.currency}>
              {mixed && <span className="totals-currency">{g.currency}</span>}
              <div className="total-card">
                <span className="total-label">Market value</span>
                <span className="total-value">{money(g.value, g.currency)}</span>
              </div>
              <div className="total-card">
                <span className="total-label">Today</span>
                <span className={`total-value ${g.dayChange >= 0 ? 'up' : 'down'}`}>
                  {signedMoney(g.dayChange, g.currency)}
                </span>
                <span className={`total-sub ${g.dayChange >= 0 ? 'up' : 'down'}`}>
                  {signedPct(g.dayChangePct)}
                </span>
              </div>
              <div className="total-card">
                <span className="total-label">Total cost</span>
                <span className="total-value">{g.cost ? money(g.cost, g.currency) : '—'}</span>
              </div>
              <div className="total-card">
                <span className="total-label">Total gain</span>
                <span className={`total-value ${g.gain >= 0 ? 'up' : 'down'}`}>
                  {g.gain == null ? '—' : signedMoney(g.gain, g.currency)}
                </span>
                <span className={`total-sub ${g.gain >= 0 ? 'up' : 'down'}`}>
                  {g.gain == null ? 'add a cost basis' : signedPct(g.gainPct)}
                </span>
              </div>
            </div>
          ))}

          {mixed && (
            <p className="note">
              Your holdings are priced in {groups.length} currencies, so they are totalled
              separately. Nothing here converts between them — an exchange rate would be one more
              number able to go stale without saying so.
            </p>
          )}

          {groups.some((g) => g.partialBasis) && (
            <p className="note">
              Total gain covers only the holdings with a cost basis filled in.
            </p>
          )}

          <div className="portfolio-body">
            <div className="table-scroll">
              <table className="holdings-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Shares</th>
                  <th className="num">Cost / share</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                  <th className="num">Today</th>
                  <th className="num">Gain</th>
                  <th className="num">Weight</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol}>
                    <td>
                      <span className="tip-dot" style={{ background: r.color }} />
                      <span className="holding-id">
                        <span className="ticker">{r.symbol}</span>
                        <span className="co-name">{r.name}</span>
                      </span>
                    </td>
                    <td className="num">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="cell-input"
                        value={r.sharesRaw}
                        onChange={(e) => onUpdate(r.symbol, { shares: e.target.value })}
                        aria-label={`Shares of ${r.symbol}`}
                        placeholder="0"
                      />
                    </td>
                    <td className="num">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="cell-input"
                        value={r.costRaw}
                        onChange={(e) => onUpdate(r.symbol, { cost: e.target.value })}
                        aria-label={`Cost per share of ${r.symbol}`}
                        placeholder="—"
                      />
                    </td>
                    <td className="num">{money(r.price, r.currency)}</td>
                    <td className="num strong">{money(r.value, r.currency)}</td>
                    <td className={`num ${r.dayChange >= 0 ? 'up' : 'down'}`}>
                      {r.dayChange == null ? '—' : signedMoney(r.dayChange, r.currency)}
                    </td>
                    <td className={`num ${r.gain >= 0 ? 'up' : 'down'}`}>
                      {r.gain == null ? (
                        '—'
                      ) : (
                        <>
                          {signedMoney(r.gain, r.currency)}
                          <span className="gain-pct">{signedPct(r.gainPct)}</span>
                        </>
                      )}
                    </td>
                    <td className="num">
                      {weightBase(r) > 0 && r.value != null
                        ? `${((r.value / weightBase(r)) * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="row-remove"
                        onClick={() => onRemove(r.symbol)}
                        aria-label={`Remove ${r.symbol} from portfolio`}
                        title={`Remove ${r.symbol}`}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>

            {groups
              .filter((g) => g.allocation.length > 0)
              .map((g) => (
                <div className="allocation" key={g.currency}>
                  <h3>Allocation{mixed ? ` · ${g.currency}` : ''}</h3>
                  <div className="donut">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={g.allocation}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="58%"
                          outerRadius="88%"
                          paddingAngle={1.5}
                          stroke="none"
                          isAnimationActive={false}
                        >
                          {g.allocation.map((a) => (
                            <Cell key={a.name} fill={a.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [money(value, g.currency), name]}
                          contentStyle={{
                            background: 'var(--panel)',
                            border: '1px solid var(--line)',
                            borderRadius: 9,
                            color: 'var(--text)',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-center">
                      <span className="donut-label">Total</span>
                      <span className="donut-value">{compact(g.value)}</span>
                    </div>
                  </div>
                  <ul className="alloc-legend">
                    {g.allocation.map((a) => (
                      <li key={a.name}>
                        <span className="tip-dot" style={{ background: a.color }} />
                        <span className="ticker">{a.name}</span>
                        <span className="alloc-pct">
                          {((a.value / g.value) * 100).toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
