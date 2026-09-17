import { useEffect, useState } from 'react';
import { fetchHistory } from '../api.js';
import { compact, money, signedMoney, signedPct, typeLabel } from '../format.js';
import AboutPanel from './AboutPanel.jsx';
import InfoTip from './InfoTip.jsx';
import PriceChart from './PriceChart.jsx';
import RangePicker from './RangePicker.jsx';

/** Percent move across the candles currently in view. */
function rangeReturn(candles) {
  if (candles.length < 2) return null;
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  return first ? ((last - first) / first) * 100 : null;
}

export default function StockDetail({ symbol, quote, inWatchlist, onToggleWatch, onSelectSymbol, refreshKey }) {
  const [range, setRange] = useState('1y');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!symbol) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchHistory(symbol, range, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [symbol, range, refreshKey]);

  if (!symbol) {
    return (
      <section className="detail detail-empty">
        <div>
          <h2>Search a stock or ETF</h2>
          <p>
            Type a ticker or company name above — you get the live quote, key stats and price
            history back to the first day it traded.
          </p>
        </div>
      </section>
    );
  }

  const meta = quote ?? data?.meta;
  const candles = data?.candles ?? [];
  const periodReturn = rangeReturn(candles);
  const dir = meta?.changePercent > 0 ? 'up' : meta?.changePercent < 0 ? 'down' : 'flat';

  return (
    <section className="detail">
      <header className="detail-head">
        <div className="detail-id">
          <h2>
            {symbol}
            {meta?.type && <span className={`badge ${meta.type.toLowerCase()}`}>{typeLabel(meta.type)}</span>}
            <InfoTip label="Where these numbers come from">
              <p>
                Quotes and candles come from Yahoo Finance, which serves the exchange this
                ticker is listed on and quotes it in that exchange&apos;s own currency. London
                quotes in <strong>pence</strong>, not pounds, and is shown that way rather than
                silently divided by a hundred.
              </p>
              <p>
                Closes are <strong>adjusted for splits and dividends</strong>, so a chart does
                not show a phantom crash on a split day and the percentage over a range is a
                total return rather than a price move. The range picker chooses the candle
                interval with it: two-minute bars for a day, monthly bars for twenty years.
              </p>
              <p className="caveat">
                Free data is delayed up to 15 minutes, and the market-open indicator uses
                regular hours for this exchange without knowing its public holidays.
              </p>
            </InfoTip>
          </h2>
          <p className="co-name">
            {meta?.name ?? '…'}
            {meta?.exchange ? ` · ${meta.exchange}` : ''}
          </p>
        </div>

        <div className="detail-price">
          <span className="px">{money(meta?.price, meta?.currency)}</span>
          <span className={`chg ${dir}`}>
            {signedMoney(meta?.change, meta?.currency)} ({signedPct(meta?.changePercent)})
          </span>
        </div>

        <button
          type="button"
          className={`watch-toggle ${inWatchlist ? 'on' : ''}`}
          onClick={() => onToggleWatch(symbol)}
        >
          {inWatchlist ? '★ In watchlist' : '☆ Add to watchlist'}
        </button>
      </header>

      <RangePicker value={range} onChange={setRange}>
        {periodReturn != null && (
          <span className={`period-return ${periodReturn >= 0 ? 'up' : 'down'}`}>
            {signedPct(periodReturn)} over range
          </span>
        )}
      </RangePicker>

      {error ? (
        <div className="chart-placeholder error">{error}</div>
      ) : (
        <PriceChart
          candles={candles}
          range={range}
          previousClose={data?.previousClose}
          loading={loading}
          currency={meta?.currency}
        />
      )}

      <dl className="stats">
        <Stat label="Previous close" value={money(meta?.previousClose, meta?.currency)} />
        <Stat
          label="Day range"
          value={meta?.dayLow ? `${money(meta.dayLow, meta.currency)} – ${money(meta.dayHigh, meta.currency)}` : '—'}
        />
        <Stat
          label="52-week range"
          value={
            meta?.fiftyTwoWeekLow
              ? `${money(meta.fiftyTwoWeekLow, meta.currency)} – ${money(meta.fiftyTwoWeekHigh, meta.currency)}`
              : '—'
          }
        />
        <Stat label="Volume" value={compact(meta?.volume)} />
        <Stat
          label="Listed since"
          value={
            meta?.firstTradeDate
              ? new Date(meta.firstTradeDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : '—'
          }
        />
        <Stat label="Data points" value={candles.length ? candles.length.toLocaleString('en-US') : '—'} />
      </dl>

      <AboutPanel symbol={symbol} onSelectSymbol={onSelectSymbol} />
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
