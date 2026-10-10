import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { amountText, compact, currencyName, money, parseAmount, signedMoney, signedPct } from '../format.js';
import { SERIES_COLORS } from './CompareView.jsx';
import InfoTip from './InfoTip.jsx';

const shown = (value) => (value === 0 || value == null ? '' : value);

const shareText = (n) =>
  n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 3 }) : '—';

export default function PortfolioView({ holdings, hiddenCount = 0, groupName, quotes, onUpdate, onRemove }) {
  const [draft, setDraft] = useState(null);

  const startEdit = (row) => {
    const text = row.own ? amountText(row.price) : '';
    setDraft({ symbol: row.symbol, text, initial: text });
  };

  const finishEdit = () => {
    if (!draft) return;
    setDraft(null);
    if (draft.text === draft.initial) return;
    const mine = parseAmount(draft.text);
    onUpdate(
      draft.symbol,
      mine > 0 ? { mine, base: quotes[draft.symbol]?.price ?? 0 } : { mine: 0, base: 0 },
    );
  };

  const changeBuy = (h, text) => {
    const patch = { buy: text };
    const mine = parseAmount(h.mine);
    if (!mine || mine === parseAmount(h.buy)) {
      patch.mine = parseAmount(text);
      patch.base = parseAmount(h.base) || quotes[h.symbol]?.price || 0;
    }
    onUpdate(h.symbol, patch);
  };

  const rows = useMemo(
    () =>
      holdings.map((h, i) => {
        const quote = quotes[h.symbol];
        const buy = parseAmount(h.buy);
        const fee = parseAmount(h.fee);
        const paid = parseAmount(h.paid);
        const counted = buy > 0 && paid > fee;
        const shares = counted ? (paid - fee) / buy : parseAmount(h.shares);

        const yahoo = quote?.price ?? null;
        const mine = parseAmount(h.mine);
        const base = parseAmount(h.base);
        const own = mine > 0;
        const tracks = own && base > 0 && yahoo != null;
        const price = own ? (tracks ? mine * (yahoo / base) : mine) : yahoo;

        const value = price != null ? shares * price : null;
        const costTotal = paid > 0 && shares > 0 ? paid : null;
        const gain = value != null && costTotal != null ? value - costTotal : null;

        return {
          symbol: h.symbol,
          holding: h,
          buyRaw: shown(h.buy),
          feeRaw: shown(h.fee),
          paidRaw: shown(h.paid),
          counted,
          oldShares: !counted && shares > 0,
          feeTooBig: paid > 0 && fee >= paid,
          yahoo,
          own,
          shares,
          name: quote?.name ?? h.symbol,
          currency: quote?.currency ?? null,
          price,
          value,
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
        // Only holdings with a cost basis contribute to the gain figure, so a
        // half-filled portfolio doesn't report a misleading total return.
        const priced = members.filter((r) => r.costTotal != null && r.value != null);
        const cost = priced.reduce((sum, r) => sum + r.costTotal, 0);
        const invested = priced.reduce((sum, r) => sum + r.value, 0);

        return {
          currency,
          rows: members,
          value,
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

  return (
    <section className="detail portfolio">
      <header className="compare-head">
        <div>
          <h2>
            Portfolio
            <InfoTip label="What the Portfolio tab computes">
              <p>
                You enter what your broker shows. Shares and gain are worked out from it:
              </p>
              <span className="formula">shares = (total paid − fee) ÷ buy price</span>
              <span className="formula">value = shares × price now    gain = value − total paid</span>
              <p>
                <strong>Price now</strong> starts at your buy price and then moves with the market,
                by Yahoo's change since then. Type your broker's current price any time to correct
                it:
              </p>
              <span className="formula">price now = your price × (Yahoo now ÷ Yahoo when you typed it)</span>
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
              {mixed && (
                <div className="totals-currency">
                  <span className="currency-code">{g.currency}</span>
                  <span className="currency-name">{currencyName(g.currency)}</span>
                  <span className="currency-count">
                    {g.rows.length} {g.rows.length === 1 ? 'holding' : 'holdings'}
                  </span>
                </div>
              )}
              <div className="total-card">
                <span className="total-label">Value</span>
                <span className="total-value">{money(g.value, g.currency)}</span>
              </div>
              <div className="total-card">
                <span className="total-label">Total paid</span>
                <span className="total-value">{g.cost ? money(g.cost, g.currency) : '—'}</span>
              </div>
              <div className="total-card">
                <span className="total-label">Total gain</span>
                <span className={`total-value ${g.gain >= 0 ? 'up' : 'down'}`}>
                  {g.gain == null ? '—' : signedMoney(g.gain, g.currency)}
                </span>
                <span className={`total-sub ${g.gain >= 0 ? 'up' : 'down'}`}>
                  {g.gain == null ? 'add buy price and total paid' : signedPct(g.gainPct)}
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

          <p className="note">
            Enter what your broker shows: buy price per share, fee, and total paid. Shares are
            worked out for you. Price now starts at your buy price and moves with the market. If
            you bought earlier, type today's price from your broker in Price now.
          </p>

          {rows.some((r) => r.oldShares) && (
            <p className="note warn-note">
              Some holdings still use a share count from before. Add their buy price and total
              paid to work out the real shares.
            </p>
          )}

          {groups.some((g) => g.partialBasis) && (
            <p className="note">
              Total gain covers only the holdings with buy price and total paid filled in.
            </p>
          )}

          <div className="portfolio-body">
            <div className="table-scroll">
              <table className="holdings-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num" title="Price per share your broker charged">Buy price</th>
                  <th className="num" title="Broker fee for this buy">Fee</th>
                  <th className="num" title="All the money you paid, fee included">Total paid</th>
                  <th className="num" title="(Total paid − fee) ÷ buy price">Shares</th>
                  <th className="num">Price now</th>
                  <th className="num">Value</th>
                  <th className="num">Gain</th>
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
                        value={r.buyRaw}
                        onChange={(e) => changeBuy(r.holding, e.target.value)}
                        aria-label={`Buy price per share of ${r.symbol}`}
                        placeholder="—"
                      />
                    </td>
                    <td className="num">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="cell-input narrow"
                        value={r.feeRaw}
                        onChange={(e) => onUpdate(r.symbol, { fee: e.target.value })}
                        aria-label={`Broker fee for ${r.symbol}`}
                        placeholder="0"
                      />
                    </td>
                    <td className="num">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="cell-input"
                        value={r.paidRaw}
                        onChange={(e) => onUpdate(r.symbol, { paid: e.target.value })}
                        aria-label={`Total paid for ${r.symbol}`}
                        placeholder="—"
                      />
                    </td>
                    <td
                      className={`num shares-cell ${r.feeTooBig ? 'down' : ''}`}
                      title={r.feeTooBig ? 'The fee must be less than the total paid' : undefined}
                    >
                      {r.feeTooBig ? 'check fee' : shareText(r.shares)}
                      {r.oldShares && <span className="price-src">from before</span>}
                    </td>
                    <td className="num">
                      <input
                        type="text"
                        inputMode="decimal"
                        className={`cell-input ${r.own ? 'own' : ''}`}
                        value={draft?.symbol === r.symbol ? draft.text : r.own ? amountText(r.price) : ''}
                        placeholder={amountText(r.yahoo) || '—'}
                        onFocus={() => startEdit(r)}
                        onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                        onBlur={finishEdit}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        aria-label={`Price now for ${r.symbol}`}
                        title="Type the price your broker shows now"
                      />
                      <span className="price-src">
                        {r.own ? `Yahoo ${money(r.yahoo, r.currency)}` : 'Yahoo price'}
                      </span>
                    </td>
                    <td className="num strong">{money(r.value, r.currency)}</td>
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
