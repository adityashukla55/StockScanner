import { useEffect, useMemo, useState } from 'react';
import { fetchProjections } from '../api.js';
import { money0, sharedCurrency, signedPct, typeLabel } from '../format.js';
import { projectionSummary, valueWithChanceOfExceeding } from '../math.js';

/**
 * The same lognormal fit as the single-ticker projection, applied across every
 * watchlist symbol so they can be read side by side.
 *
 * Deliberately not a ranking of "best picks": the risk columns sit next to the
 * return columns, nothing is sorted by outcome unless the reader asks for it,
 * and no row is highlighted as a choice.
 */

const COLUMNS = [
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'cagr', label: 'Past return / yr', hint: 'Annualised growth over the fitted window' },
  { key: 'vol', label: 'Volatility', hint: 'Annualised standard deviation of returns' },
  { key: 'maxDrawdown', label: 'Worst fall', hint: 'Largest peak-to-trough drop inside the window' },
  { key: 'downside', label: 'Downside (10%)', hint: '1 in 10 outcomes finish below this' },
  { key: 'median', label: 'Median', hint: 'The middle outcome' },
  { key: 'upside', label: 'Upside (10%)', hint: '1 in 10 outcomes finish above this' },
  { key: 'probLoss', label: 'Chance of loss', hint: 'Modelled probability of ending below what you put in' },
];

export default function WatchlistProjection({ symbols, amount, years, lookback }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 'desc' });

  useEffect(() => {
    if (!symbols.length) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchProjections(symbols, lookback, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [symbols, lookback]);

  /**
   * The unit for the shared amount above the table.
   *
   * Every row is the same hypothetical sum run through a different ticker, so it
   * only has a currency when every ticker agrees on one. Across a watchlist
   * spanning exchanges it stays a bare number — naming a currency there would be
   * picking one arbitrarily.
   */
  const unit = sharedCurrency(data?.models ?? []);

  const rows = useMemo(() => {
    if (!data?.models || !(amount > 0) || !(years > 0)) return [];

    const built = data.models.map((m) => {
      const args = { amount, drift: m.model.driftAnnual, vol: m.model.volAnnual, years };
      const summary = projectionSummary(args);
      return {
        symbol: m.symbol,
        name: m.name,
        type: m.type,
        currency: m.currency,
        cagr: m.model.cagr,
        vol: m.model.volAnnual,
        maxDrawdown: m.model.maxDrawdown,
        downside: valueWithChanceOfExceeding({ ...args, probability: 0.9 }),
        median: summary.median,
        upside: valueWithChanceOfExceeding({ ...args, probability: 0.1 }),
        probLoss: summary.probLoss,
        // No asset compounds at this rate for a decade. When the fitted window
        // caught such a run, extrapolating it produces numbers that look
        // authoritative and are not.
        extreme: (m.model.cagr ?? 0) > 0.25,
      };
    });

    if (!sort.key) return built; // Watchlist order until the reader chooses.
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...built].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (typeof x === 'string') return x.localeCompare(y) * factor;
      return ((x ?? 0) - (y ?? 0)) * factor;
    });
  }, [data, amount, years, sort]);

  const toggleSort = (key) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' },
    );

  if (!symbols.length) return null;

  return (
    <section className="wl-projection">
      <div className="about-head">
        <h3>The same model across your watchlist</h3>
        {loading && <span className="text-dim tiny">Fitting {symbols.length} models…</span>}
      </div>

      <p className="wl-intro">
        Every ticker below is run through the identical fit, for {money0(amount, unit)} over {years}{' '}
        {years === 1 ? 'year' : 'years'}. Columns are sortable — but note that the ones with the
        highest past return also carry the widest spread and the deepest historical fall. That
        pairing is the whole point of reading them together.
      </p>

      {error ? (
        <p className="text-dim">Could not fit models: {error}</p>
      ) : (
        <div className="table-scroll">
          <table className="wl-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.align === 'left' ? '' : 'num'} sortable ${sort.key === col.key ? 'sorted' : ''}`}
                    onClick={() => toggleSort(col.key)}
                    title={col.hint ?? `Sort by ${col.label}`}
                  >
                    {col.label}
                    {sort.key === col.key && <span className="arrow">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <span className="ticker">{r.symbol}</span>
                    <span className="badge">{typeLabel(r.type)}</span>
                  </td>
                  <td className="num">{signedPct((r.cagr ?? 0) * 100)}</td>
                  <td className="num">{(r.vol * 100).toFixed(1)}%</td>
                  <td className="num down">{(r.maxDrawdown * 100).toFixed(1)}%</td>
                  <td className="num">{money0(r.downside, r.currency)}</td>
                  <td className={`num strong ${r.extreme ? 'implausible' : ''}`}>
                    {money0(r.median, r.currency)}
                    {r.extreme && (
                      <span
                        className="warn-flag"
                        title="Fitted growth above 25%/yr. Extrapolating it over years is not credible — read this row as a demonstration of the model's limits, not a projection."
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="num">{money0(r.upside, r.currency)}</td>
                  <td className="num">{(r.probLoss * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.failed?.length > 0 && (
        <p className="compare-warn">Could not fit: {data.failed.join(', ')}</p>
      )}

      {rows.some((r) => r.extreme) && (
        <p className="note warn-note">
          ⚠ marks a row whose fitted growth exceeds 25% a year. Nothing compounds at that rate
          for long, so those medians are the model breaking down, not a prediction.
        </p>
      )}

      <p className="note">
        Notice that <em>Chance of loss</em> falls as past return rises, making the most volatile
        row look safest. That is an artefact: the model assumes the fitted drift simply
        continues, so a violent past run is read as near-certain future gain. It is the clearest
        sign that these columns describe history, not risk.
      </p>

      <p className="disclaimer">
        <strong>This is not a ranking of what to buy.</strong> Every number is fitted to past
        prices, and a high past return is not evidence of a high future one — it often just
        means the window caught a good run in something volatile. The model cannot see
        valuation, business quality, concentration, or the fact that holding several of these
        at once may be holding the same bet more than once. Choosing between them is a
        judgement about the future that no amount of historical arithmetic settles.
      </p>
    </section>
  );
}
