import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchImpliedVol, fetchProjection } from '../api.js';
import { compact, money, money0, signedPct } from '../format.js';
import WatchlistProjection from './WatchlistProjection.jsx';
import InfoTip from './InfoTip.jsx';
import {
  probabilityOfAtLeast,
  projectionBands,
  projectionSummary,
  valueWithChanceOfExceeding,
  volAtHorizon,
} from '../math.js';

const LOOKBACKS = [
  ['1y', '1 year'],
  ['5y', '5 years'],
  ['10y', '10 years'],
  ['max', 'All history'],
];

const CHANCES = [0.95, 0.9, 0.75, 0.5, 0.25, 0.1];

const pctFmt = (p) => `${(p * 100).toFixed(0)}%`;

function BandTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const years = label;

  return (
    <div className="chart-tip">
      <div className="chart-tip-date">
        {years === 0 ? 'Today' : `In ${years.toFixed(1).replace(/\.0$/, '')} years`}
      </div>
      <ul className="tip-rows">
        <li>
          <span className="tip-dot" style={{ background: 'var(--accent)' }} />
          <span className="tip-sym">Best 10%</span>
          <span className="tip-val">above {money(row.p90, currency)}</span>
        </li>
        <li>
          <span className="tip-dot" style={{ background: 'var(--text)' }} />
          <span className="tip-sym">Median</span>
          <span className="tip-val">{money(row.p50, currency)}</span>
        </li>
        <li>
          <span className="tip-dot" style={{ background: 'var(--text-dim)' }} />
          <span className="tip-sym">Worst 10%</span>
          <span className="tip-val">below {money(row.p10, currency)}</span>
        </li>
      </ul>
    </div>
  );
}

export default function ProjectionView({ symbol, watchlist, onPickSymbol }) {
  const [showAll, setShowAll] = useState(false);
  const [lookback, setLookback] = useState('10y');
  const [amount, setAmount] = useState('10000');
  const [years, setYears] = useState(10);
  const [chance, setChance] = useState(0.9);
  const [target, setTarget] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [volSource, setVolSource] = useState('historical');
  const [iv, setIv] = useState(null);

  useEffect(() => {
    if (!symbol) return undefined;
    const controller = new AbortController();
    setIv(null);

    fetchImpliedVol(symbol, controller.signal)
      .then(setIv)
      // Options are a bonus input; if they fail we simply stay on history.
      .catch(() => setIv(null));

    return () => controller.abort();
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchProjection(symbol, lookback, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
          setData(null);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [symbol, lookback]);

  const amountNum = Number(String(amount).replace(/[,$\s]/g, '')) || 0;
  const drift = data?.model.driftAnnual ?? 0;

  const historicalVol = data?.model.volAnnual ?? 0;
  const impliedPoints = iv?.supported ? iv.points : null;
  const impliedVolHere = impliedPoints ? volAtHorizon(impliedPoints, years) : null;
  // Beyond the last listed expiry the implied level is held flat, which is
  // extrapolation — the UI says so rather than quietly pretending otherwise.
  const impliedIsExtrapolated =
    impliedPoints != null && years > impliedPoints[impliedPoints.length - 1].years;

  const useImplied = volSource === 'implied' && impliedVolHere != null;
  const vol = useImplied ? impliedVolHere : historicalVol;
  const ready = data != null && amountNum > 0 && years > 0 && vol > 0;

  const scenario = useMemo(() => {
    if (!ready) return null;
    const args = { amount: amountNum, drift, vol, years };
    return {
      headline: valueWithChanceOfExceeding({ ...args, probability: chance }),
      summary: projectionSummary(args),
      outcomes: CHANCES.map((p) => ({
        probability: p,
        value: valueWithChanceOfExceeding({ ...args, probability: p }),
      })),
      bands: projectionBands({ ...args, percentiles: [0.1, 0.25, 0.5, 0.75, 0.9] }).map((row) => ({
        ...row,
        band80: [row.p10, row.p90],
        band50: [row.p25, row.p75],
      })),
    };
  }, [ready, amountNum, drift, vol, years, chance]);

  const targetNum = Number(String(target).replace(/[,$\s]/g, '')) || 0;
  const targetChance =
    ready && targetNum > 0
      ? probabilityOfAtLeast({ amount: amountNum, drift, vol, years, target: targetNum })
      : null;

  const candidates = [...new Set([...(symbol ? [symbol] : []), ...watchlist])];

  return (
    <section className="detail projection">
      <header className="compare-head">
        <div>
          <h2>
            Projection
            <InfoTip label="How the projection is calculated">
              <p>
                A <strong>lognormal model</strong> — geometric Brownian motion — fitted to the
                ticker's own history. Every band on the chart is a percentile of that
                distribution:
              </p>
              <span className="formula">value(t, p) = amount × exp(μt + z(p)·σ√t)</span>
              <p>
                <strong>μ</strong> and <strong>σ</strong> are estimated from the log returns of
                the fitting window: μ is their mean and σ the square root of their sample
                variance (n−1), both annualised by the sampling rate measured from the candles
                themselves. <strong>z(p)</strong> is the inverse normal at that percentile, so
                the median line is simply exp(μt) and the shaded bands are the middle 50% and
                80%.
              </p>
              <p>
                On the <strong>option market</strong> setting σ instead comes from live option
                prices, recovered by inverting Black-Scholes with bisection across strikes near
                the money. The drift still comes from past prices: options carry no view on
                direction.
              </p>
              <p className="caveat">
                This is arithmetic over prices that have already happened. Real markets have fat
                tails, crashes and regime changes the model does not reproduce, and it ignores
                fees, taxes and inflation. A spread of possibilities, not a forecast.
              </p>
            </InfoTip>
          </h2>
        </div>
      </header>

      <div className="chips">
        {candidates.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${s === symbol ? 'on' : ''}`}
            style={s === symbol ? { '--chip': 'var(--accent)' } : undefined}
            aria-pressed={s === symbol}
            onClick={() => onPickSymbol(s)}
          >
            {s === symbol && <span className="chip-dot" />}
            {s}
          </button>
        ))}
        <span className="chips-hint">Search above to project any other ticker</span>
      </div>

      {!symbol ? (
        <div className="chart-placeholder">Pick a ticker to project.</div>
      ) : error ? (
        <div className="chart-placeholder error">{error}</div>
      ) : !data && loading ? (
        <div className="chart-placeholder">Fitting the model…</div>
      ) : (
        <>
          <div className="inputs">
            <label className="field">
              <span>If I invest today</span>
              <div className="input-money">
                <span className="prefix">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label="Amount invested today"
                />
              </div>
            </label>

            <label className="field">
              <span>
                for <strong>{years}</strong> {years === 1 ? 'year' : 'years'}
              </span>
              <input
                type="range"
                min="1"
                max="40"
                step="1"
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                aria-label="Years invested"
              />
            </label>

            <label className="field">
              <span>Model fitted on</span>
              <select value={lookback} onChange={(e) => setLookback(e.target.value)}>
                {LOOKBACKS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="vol-source">
            <span className="vol-label">Volatility from</span>
            <div className="vol-options">
              <button
                type="button"
                className={!useImplied ? 'on' : ''}
                onClick={() => setVolSource('historical')}
                aria-pressed={!useImplied}
              >
                Past prices
                <strong>{(historicalVol * 100).toFixed(1)}%</strong>
              </button>
              <button
                type="button"
                className={useImplied ? 'on' : ''}
                onClick={() => setVolSource('implied')}
                disabled={impliedVolHere == null}
                aria-pressed={useImplied}
                title={
                  impliedVolHere == null
                    ? iv?.reason ?? 'No option quotes available for this symbol'
                    : 'Implied by traded option prices — the market’s own forward-looking estimate'
                }
              >
                Option market
                <strong>{impliedVolHere == null ? '—' : `${(impliedVolHere * 100).toFixed(1)}%`}</strong>
              </button>
            </div>

            {impliedPoints && (
              <p className="vol-term">
                Market term structure:{' '}
                {impliedPoints.map((p) => `${p.days}d ${(p.impliedVol * 100).toFixed(1)}%`).join(' · ')}
                {useImplied && impliedIsExtrapolated && (
                  <span className="vol-warn">
                    {' '}— options are only quoted to {impliedPoints[impliedPoints.length - 1].days} days,
                    so the level is held flat beyond that.
                  </span>
                )}
              </p>
            )}
            {iv && !iv.supported && (
              <p className="vol-term text-dim">{iv.reason} — using past prices.</p>
            )}
          </div>

          {scenario && (
            <>
              <p className="headline">
                There is a{' '}
                <select
                  className="inline-select"
                  value={chance}
                  onChange={(e) => setChance(Number(e.target.value))}
                  aria-label="Probability"
                >
                  {CHANCES.map((p) => (
                    <option key={p} value={p}>
                      {pctFmt(p)}
                    </option>
                  ))}
                </select>{' '}
                chance that <strong>{money0(amountNum, data.currency)}</strong> in{' '}
                <strong>{data.symbol}</strong> is worth at least{' '}
                <strong className={scenario.headline >= amountNum ? 'up' : 'down'}>
                  {money0(scenario.headline, data.currency)}
                </strong>{' '}
                in <strong>{years}</strong> {years === 1 ? 'year' : 'years'}.
              </p>

              <div className="chart-wrap projection-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={scenario.bands}
                    margin={{ top: 10, right: 8, left: 8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.06} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis
                      dataKey="year"
                      type="number"
                      domain={[0, years]}
                      tickFormatter={(t) => (t === 0 ? 'now' : `${Math.round(t)}y`)}
                      tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                      axisLine={{ stroke: 'var(--grid)' }}
                      tickLine={false}
                      minTickGap={32}
                    />
                    <YAxis
                      orientation="right"
                      width={70}
                      scale="log"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(v) => `$${compact(v)}`}
                      tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ReferenceLine
                      y={amountNum}
                      stroke="var(--text-dim)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.7}
                    />
                    <Tooltip content={<BandTooltip currency={data.currency} />} cursor={{ stroke: 'var(--text-dim)', strokeDasharray: '3 3' }} />
                    <Area
                      dataKey="band80"
                      stroke="none"
                      fill="url(#bandFill)"
                      isAnimationActive={false}
                      activeDot={false}
                    />
                    <Area
                      dataKey="band50"
                      stroke="none"
                      fill="var(--accent)"
                      fillOpacity={0.18}
                      isAnimationActive={false}
                      activeDot={false}
                    />
                    <Line
                      dataKey="p50"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="chart-caption">
                Darker band: the middle 50% of outcomes. Lighter band: the middle 80%. Line:
                the median. Dashed line: your original {money0(amountNum, data.currency)}.
              </p>

              <div className="projection-grid">
                <div>
                  <h3>Chance of at least…</h3>
                  <table className="outcomes-table">
                    <tbody>
                      {scenario.outcomes.map((o) => (
                        <tr key={o.probability}>
                          <td className="prob">{pctFmt(o.probability)} chance</td>
                          <td className="num strong">{money0(o.value, data.currency)}</td>
                          <td className={`num ${o.value >= amountNum ? 'up' : 'down'}`}>
                            {signedPct(((o.value - amountNum) / amountNum) * 100)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3>Or work backwards</h3>
                  <label className="field">
                    <span>Chance of reaching at least</span>
                    <div className="input-money">
                      <span className="prefix">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={target}
                        placeholder="25000"
                        onChange={(e) => setTarget(e.target.value)}
                        aria-label="Target value"
                      />
                    </div>
                  </label>
                  <p className="target-answer">
                    {targetChance == null ? (
                      <span className="text-dim">Enter a target to see its odds.</span>
                    ) : (
                      <>
                        <strong>{(targetChance * 100).toFixed(1)}%</strong> chance of reaching{' '}
                        {money0(targetNum, data.currency)} within {years} {years === 1 ? 'year' : 'years'}.
                      </>
                    )}
                  </p>

                  <dl className="mini-stats">
                    <div>
                      <dt>Chance of a loss</dt>
                      <dd className="down">{(scenario.summary.probLoss * 100).toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt>Chance of doubling</dt>
                      <dd className="up">{(scenario.summary.probDouble * 100).toFixed(1)}%</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="model-facts">
                <h3>What this is built on</h3>
                <dl className="stats">
                  <div className="stat">
                    <dt>Historical return</dt>
                    <dd>{signedPct((data.model.cagr ?? 0) * 100)} / year</dd>
                  </div>
                  <div className="stat">
                    <dt>Volatility</dt>
                    <dd>
                      {(vol * 100).toFixed(1)}% / year
                      <span className="stat-note">{useImplied ? 'option market' : 'past prices'}</span>
                    </dd>
                  </div>
                  <div className="stat">
                    <dt>Fitted on</dt>
                    <dd>
                      {data.model.spanYears.toFixed(1)} years · {data.model.samples.toLocaleString('en-US')} periods
                    </dd>
                  </div>
                  <div className="stat">
                    <dt>Window</dt>
                    <dd>
                      {new Date(data.model.from).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      {' – '}
                      {new Date(data.model.to).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="disclaimer">
                <strong>How to read this.</strong> The model assumes returns stay lognormal with
                the same average drift and volatility {data.symbol} showed over the window above —
                so it inherits whatever that window happened to contain, and a long bull run makes
                the whole fan look optimistic. Try switching the window to see how much the answer
                moves. Real markets have fat tails, crashes and regime changes this model does not
                reproduce, and the figures ignore fees, taxes, inflation and dividends beyond
                those already in the adjusted price. It is arithmetic on past prices, not a
                forecast and not investment advice.
              </p>

              {useImplied && (
                <p className="note">
                  On the option-market setting, only the <em>spread</em> comes from the market.
                  The drift still comes from past prices, because options carry no view on
                  direction — their own implied drift is the risk-free rate, a pricing
                  convention rather than a forecast. Implied volatility also tends to sit a
                  little above what actually gets realised, since it includes a risk premium.
                </p>
              )}

              <div className="wl-toggle">
                <button type="button" className="ghost-btn" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Hide watchlist comparison' : `Run this across all ${watchlist.length} watchlist tickers`}
                </button>
              </div>

              {showAll && (
                <WatchlistProjection
                  symbols={watchlist}
                  amount={amountNum}
                  years={years}
                  lookback={lookback}
                />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
