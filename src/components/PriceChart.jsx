import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { axisLabel, money, tooltipLabel } from '../format.js';

function ChartTooltip({ active, payload, range, currency }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="chart-tip-date">{tooltipLabel(point.t, range)}</div>
      <div className="chart-tip-price">{money(point.close, currency)}</div>
      {point.volume != null && <div className="chart-tip-vol">Vol {point.volume.toLocaleString('en-US')}</div>}
    </div>
  );
}

export default function PriceChart({ candles, range, previousClose, loading, currency }) {
  const { domain, up, baseline } = useMemo(() => {
    if (!candles.length) return { domain: [0, 1], up: true, baseline: null };

    const closes = candles.map((c) => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    // Intraday charts are measured against the prior close, longer ones against
    // the first candle in view.
    const base = range === '1d' && previousClose != null ? previousClose : closes[0];
    const pad = (max - min || max * 0.02) * 0.08;

    return {
      // A price is never negative, so the padding must not push the axis below zero.
      domain: [Math.max(0, Math.min(min, base ?? min) - pad), Math.max(max, base ?? max) + pad],
      up: closes[closes.length - 1] >= base,
      baseline: range === '1d' ? previousClose : null,
    };
  }, [candles, range, previousClose]);

  const color = up ? 'var(--up)' : 'var(--down)';

  if (loading && !candles.length) return <div className="chart-placeholder">Loading chart…</div>;
  if (!candles.length) return <div className="chart-placeholder">No price data for this range.</div>;

  return (
    <div className={`chart-wrap ${loading ? 'is-stale' : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={candles} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            domain={domain}
            orientation="right"
            width={68}
            tickFormatter={(v) => money(v, currency)}
            tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          {baseline != null && (
            <ReferenceLine y={baseline} stroke="var(--text-dim)" strokeDasharray="4 4" strokeOpacity={0.6} />
          )}
          <Tooltip
            content={<ChartTooltip range={range} currency={currency} />}
            cursor={{ stroke: 'var(--text-dim)', strokeDasharray: '3 3' }}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={1.8}
            fill="url(#priceFill)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
