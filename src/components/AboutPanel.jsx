import { useEffect, useState } from 'react';
import { fetchProfile } from '../api.js';
import { compact } from '../format.js';

const pct = (weight) => `${(weight * 100).toFixed(weight < 0.01 ? 2 : 1)}%`;

/** Long business summaries run to a page; show the gist and let it expand. */
function Summary({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  const isLong = text.length > 340;
  return (
    <p className="about-summary">
      {open || !isLong ? text : `${text.slice(0, 340).trimEnd()}…`}
      {isLong && (
        <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </p>
  );
}

export default function AboutPanel({ symbol, onSelectSymbol }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!symbol) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);

    fetchProfile(symbol, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [symbol]);

  if (loading) return <section className="about"><p className="text-dim">Loading profile…</p></section>;
  if (error) return <section className="about"><p className="text-dim">No profile available ({error}).</p></section>;
  if (!data) return null;

  const fund = data.fund;

  return (
    <section className="about">
      <div className="about-head">
        <h3>About {symbol}</h3>
        <a className="ext-link" href={data.yahooUrl} target="_blank" rel="noreferrer noopener">
          Full profile on Yahoo Finance ↗
        </a>
      </div>

      <Summary text={data.summary} />

      <ul className="about-facts">
        {data.sector && (
          <li>
            <span className="k">Sector</span>
            <span className="v">{data.sector}</span>
          </li>
        )}
        {data.industry && (
          <li>
            <span className="k">Industry</span>
            <span className="v">{data.industry}</span>
          </li>
        )}
        {data.employees && (
          <li>
            <span className="k">Employees</span>
            <span className="v">{compact(data.employees)}</span>
          </li>
        )}
        {fund?.family && (
          <li>
            <span className="k">Provider</span>
            <span className="v">{fund.family}</span>
          </li>
        )}
        {fund?.category && (
          <li>
            <span className="k">Category</span>
            <span className="v">{fund.category}</span>
          </li>
        )}
        {fund?.expenseRatio != null && (
          <li>
            <span className="k">Expense ratio</span>
            <span className="v">{(fund.expenseRatio * 100).toFixed(2)}% / year</span>
          </li>
        )}
        {data.website && (
          <li>
            <span className="k">Website</span>
            <span className="v">
              <a href={data.website} target="_blank" rel="noreferrer noopener">
                {data.website.replace(/^https?:\/\/(www\.)?/, '')} ↗
              </a>
            </span>
          </li>
        )}
      </ul>

      {fund?.holdings?.length > 0 && (
        <div className="about-cols">
          <div>
            <h4>Top holdings</h4>
            <ul className="holdings-list">
              {fund.holdings.map((h) => (
                <li key={h.symbol ?? h.name}>
                  {h.symbol ? (
                    <button
                      type="button"
                      className="holding-link"
                      onClick={() => onSelectSymbol(h.symbol)}
                      title={`Open ${h.symbol}`}
                    >
                      {h.symbol}
                    </button>
                  ) : (
                    <span className="holding-link is-plain">—</span>
                  )}
                  <span className="holding-name">{h.name}</span>
                  <span className="weight-cell">
                    <span
                      className="weight-bar"
                      style={{ width: `${Math.min(100, (h.weight / fund.holdings[0].weight) * 100)}%` }}
                    />
                    <span className="weight-num">{pct(h.weight)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-dim tiny">
              Yahoo publishes the ten largest positions; the fund holds more.
            </p>
          </div>

          {fund.sectors?.length > 0 && (
            <div>
              <h4>Sector mix</h4>
              <ul className="sector-list">
                {fund.sectors.map((s) => (
                  <li key={s.name}>
                    <span className="sector-name">{s.name}</span>
                    <span className="weight-cell">
                      <span className="weight-bar" style={{ width: `${s.weight * 100}%` }} />
                      <span className="weight-num">{pct(s.weight)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
