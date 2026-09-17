export const RANGES = [
  ['1d', '1D'],
  ['5d', '5D'],
  ['1mo', '1M'],
  ['6mo', '6M'],
  ['ytd', 'YTD'],
  ['1y', '1Y'],
  ['5y', '5Y'],
  ['10y', '10Y'],
  ['max', 'MAX'],
];

export default function RangePicker({ value, onChange, children }) {
  return (
    <nav className="ranges" aria-label="Chart range">
      {RANGES.map(([range, label]) => (
        <button
          key={range}
          type="button"
          className={range === value ? 'on' : ''}
          aria-pressed={range === value}
          onClick={() => onChange(range)}
        >
          {label}
        </button>
      ))}
      {children}
    </nav>
  );
}
