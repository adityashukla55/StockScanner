import { useEffect, useMemo, useState } from 'react';
import { fetchPortfolio } from '../api.js';
import { money0, sharedCurrency, signedPct } from '../format.js';
import {
  logDriftFrom,
  mixStats,
  normalizeWeights,
  optimizeWeights,
  projectionSummary,
  valueWithChanceOfExceeding,
} from '../math.js';
import { SERIES_COLORS } from './CompareView.jsx';
import InfoTip from './InfoTip.jsx';

const LOOKBACKS = [
  ['1y', '1 year'],
  ['5y', '5 years'],
  ['10y', '10 years'],
  ['max', 'All history'],
];

const pct1 = (x) => `${(x * 100).toFixed(1)}%`;

/**
 * "Best" has to be said out loud, because these three disagree — the highest
 * return is always one holding at 100%, and the steadiest is usually the
 * dullest. Naming the objective keeps the choice with the reader.
 */
const OBJECTIVES = [
  ['sharpe', 'Most return per risk', 'The mix with the highest past return for each unit of volatility'],
  ['minvol', 'Steadiest', 'The mix with the lowest volatility, whatever it returned'],
  ['return', 'Highest past return', 'Whatever returned most — this collapses into a single holding'],
];

export default function AllocationView({ watchlist, picks, onPicksChange, group, onUseGroup }) {
  const [lookback, setLookback] = useState('5y');
  const [amount, setAmount] = useState('25000');
  const [years, setYears] = useState(10);
  const [rawWeights, setRawWeights] = useState({});
  const [fitted, setFitted] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (picks.length < 2) {
      setData(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchPortfolio(picks, lookback, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
          setData(null);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [picks, lookback]);

  const assets = data?.assets ?? [];

  /**
   * The unit for the blended amount below.
   *
   * A blend across exchanges has no single currency, and converting between them
   * would mean carrying an exchange rate that can go stale without saying so. A
   * mixed selection therefore shows bare numbers: the weights and percentages
   * are still exactly right, only the unit is withheld.
   */
  const unit = sharedCurrency(assets);
  const mu = useMemo(() => assets.map((a) => a.annualReturn), [assets]);
  const cov = data?.covariance ?? [];

  // Slider positions are kept raw and normalised only when used, so dragging
  // one holding does not yank all the others around under the cursor.
  const weights = useMemo(() => {
    if (!assets.length) return [];
    return normalizeWeights(assets.map((a) => rawWeights[a.symbol] ?? 1));
  }, [assets, rawWeights]);

  const amountNum = Number(String(amount).replace(/[,$\s]/g, '')) || 0;
  const ready = assets.length >= 2 && cov.length === assets.length && amountNum > 0;

  const yours = useMemo(
    () => (ready ? { ...mixStats(weights, mu, cov), weights, label: 'Your split' } : null),
    [ready, weights, mu, cov],
  );

  // What the mix is expected to do with the money, via the same lognormal model
  // the projection tab uses.
  const outcome = useMemo(() => {
    if (!yours || !(years > 0)) return null;
    const drift = logDriftFrom(yours.ret, yours.vol);
    const args = { amount: amountNum, drift, vol: yours.vol, years };
    return {
      summary: projectionSummary(args),
      bands: [0.9, 0.75, 0.5, 0.25, 0.1].map((p) => ({
        probability: p,
        value: valueWithChanceOfExceeding({ ...args, probability: p }),
      })),
    };
  }, [yours, amountNum, years]);

  // The gap between a mix's volatility and the weighted average of its parts
  // is exactly what holding several different things buys you.
  const diversification = useMemo(() => {
    if (!yours) return null;
    const naive = weights.reduce((sum, w, i) => sum + w * assets[i].vol, 0);
    return { naive, actual: yours.vol, saved: naive - yours.vol };
  }, [yours, weights, assets]);

  const applyObjective = (objective) => {
    const weights = optimizeWeights({ mu, cov, objective });
    setRawWeights(
      Object.fromEntries(assets.map((a, i) => [a.symbol, Math.round(weights[i] * 1000) / 10])),
    );
    setFitted(objective);
  };

  const togglePick = (symbol) =>
    onPicksChange(
      picks.includes(symbol)
        ? picks.filter((s) => s !== symbol)
        : picks.length >= 8
          ? picks
          : [...picks, symbol],
    );

  const candidates = [...new Set([...picks, ...watchlist])];

  return (
    <section className="detail allocation">
      <header className="compare-head">
        <div>
          <h2>
            Allocation
            <InfoTip label="How the allocation fits are calculated">
              <p>
                A mix of weights is scored on the covariance of its holdings, which is what makes
                a blend behave differently from the sum of its parts:
              </p>
              <span className="formula">
                return = wᵀμ    volatility = √(wᵀΣw)
              </span>
              <p>
                <strong>μ</strong> is each ticker's annualised mean return and <strong>Σ</strong>
                their annualised covariance matrix, both estimated from daily returns over the
                lookback. The fit buttons search weights for the best score under one objective:
                most return per unit of volatility, lowest volatility outright, or highest past
                return — the last of which collapses into a single holding, which is the point of
                showing it.
              </p>
              <p className="caveat">
                Every input is an estimate from one window of history, and covariance estimated
                from a few years of daily data is noisy. A fit describes what would have worked;
                it is not a recommendation about what comes next.
              </p>
            </InfoTip>
          </h2>
        </div>
        {group && watchlist.length > 0 && (
          <button type="button" className="ghost-btn plain" onClick={onUseGroup}>
            Use all in {group.name}
          </button>
        )}
      </header>

      <div className="chips">
        {candidates.map((symbol) => {
          const on = picks.includes(symbol);
          const i = assets.findIndex((a) => a.symbol === symbol);
          return (
            <button
              key={symbol}
              type="button"
              className={`chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => togglePick(symbol)}
              style={on && i >= 0 ? { '--chip': SERIES_COLORS[i % SERIES_COLORS.length] } : undefined}
            >
              {on && <span className="chip-dot" />}
              {symbol}
            </button>
          );
        })}
        <span className="chips-hint">
          {picks.length >= 8 ? 'Eight is the maximum' : 'Search above to add any other ticker'}
        </span>
      </div>

      {picks.length < 2 ? (
        <div className="chart-placeholder">Pick at least two holdings to split between.</div>
      ) : error ? (
        <div className="chart-placeholder error">{error}</div>
      ) : !data && loading ? (
        <div className="chart-placeholder">Measuring how these move together…</div>
      ) : ready ? (
        <>
          <div className="inputs">
            <label className="field">
              <span>Amount to invest</span>
              <div className="input-money">
                <span className="prefix">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label="Amount to invest"
                />
              </div>
            </label>

            <label className="field">
              <span>
                held for <strong>{years}</strong> {years === 1 ? 'year' : 'years'}
              </span>
              <input
                type="range"
                min="1"
                max="40"
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                aria-label="Years held"
              />
            </label>

            <label className="field">
              <span>Measured over</span>
              <select value={lookback} onChange={(e) => setLookback(e.target.value)}>
                {LOOKBACKS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="alloc-head">
            <h3>Your split</h3>
            <div className="alloc-actions">
              <button
                type="button"
                className={`ghost-btn ${fitted === null ? 'on' : ''}`}
                onClick={() => {
                  setRawWeights({});
                  setFitted(null);
                }}
              >
                Equal split
              </button>
              {OBJECTIVES.map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  className={`ghost-btn ${fitted === key ? 'on' : ''}`}
                  title={hint}
                  onClick={() => applyObjective(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ul className="weight-rows">
            {assets.map((asset, i) => (
              <li key={asset.symbol}>
                <span className="w-id">
                  <span className="tip-dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  <span className="ticker">{asset.symbol}</span>
                  <span className="co-name">{asset.name}</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={rawWeights[asset.symbol] ?? 100 / assets.length}
                  onChange={(e) =>
                    setRawWeights((prev) => ({
                      ...prev,
                      // Fill in the others so moving one slider keeps the rest put.
                      ...Object.fromEntries(
                        assets.map((a) => [a.symbol, prev[a.symbol] ?? 100 / assets.length]),
                      ),
                      [asset.symbol]: Number(e.target.value),
                    }))
                  }
                  aria-label={`Weight of ${asset.symbol}`}
                />
                <span className="w-pct">{pct1(weights[i])}</span>
                <span className="w-cash">{money0(weights[i] * amountNum, unit)}</span>
              </li>
            ))}
          </ul>

          <div className="alloc-grid">
            <div className="alloc-stat">
              <span className="total-label">Past return of this mix</span>
              <span className="total-value">{signedPct(yours.ret * 100)} / yr</span>
              <span className="total-sub">over the {data.spanYears.toFixed(1)} years measured</span>
            </div>
            <div className="alloc-stat">
              <span className="total-label">Volatility</span>
              <span className="total-value">{pct1(yours.vol)} / yr</span>
              <span className="total-sub">
                {diversification.saved > 0.0005
                  ? `${pct1(diversification.saved)} less than its parts`
                  : 'no diversification benefit'}
              </span>
            </div>
            <div className="alloc-stat">
              <span className="total-label">Chance of a loss</span>
              <span className="total-value down">
                {(outcome.summary.probLoss * 100).toFixed(1)}%
              </span>
              <span className="total-sub">over {years} years, modelled</span>
            </div>
          </div>

          <h3 className="outcome-title">
            What {money0(amountNum, unit)} could become in {years} {years === 1 ? 'year' : 'years'}
          </h3>
          <table className="outcomes-table wide">
            <tbody>
              {outcome.bands.map((b) => (
                <tr key={b.probability}>
                  <td className="prob">{(b.probability * 100).toFixed(0)}% chance of at least</td>
                  <td className="num strong">{money0(b.value, unit)}</td>
                  <td className={`num ${b.value >= amountNum ? 'up' : 'down'}`}>
                    {signedPct(((b.value - amountNum) / amountNum) * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
