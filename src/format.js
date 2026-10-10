/**
 * Money, in whatever currency the exchange quotes in.
 *
 * Three things make this less trivial than an Intl formatter:
 *
 * 1. London quotes in *pence* (`GBp`), not pounds. Intl accepts that code as
 *    `GBP` and would render 566.8 as £566.80 — wrong by a factor of a hundred.
 *    Pence get their own path, shown the way the exchange quotes them rather
 *    than silently converted.
 * 2. A currency symbol is only ever shown when it is unambiguous. Mixed-currency
 *    views fall back to a plain number, because inventing a unit is worse than
 *    omitting one.
 * 3. Formatters are cached; constructing Intl.NumberFormat per render is slow
 *    enough to notice in a table of forty rows.
 */

// Exchanges that quote in a hundredth of the main unit. Yahoo reports the
// subunit code, and the price is already in that subunit.
const SUBUNIT = { GBp: 'p', GBX: 'p', ZAc: 'c', ILA: 'ag' };

const cache = new Map();

const LOCALE_DECIMAL = (() => {
  try {
    return new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  } catch {
    return '.';
  }
})();

export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').replace(/[^\d.,-]/g, '');
  if (!text) return 0;

  const dots = text.split('.').length - 1;
  const commas = text.split(',').length - 1;

  if (dots && commas) {
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    text = text.split(group).join('').replace(decimal, '.');
  } else if (dots || commas) {
    const sep = dots ? '.' : ',';
    const digitsAfter = text.length - text.lastIndexOf(sep) - 1;
    const grouping = dots + commas > 1 || (digitsAfter === 3 && sep !== LOCALE_DECIMAL);
    text = grouping ? text.split(sep).join('') : text.replace(sep, '.');
  }

  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

const SUBUNIT_NAMES = { GBp: 'British pence', GBX: 'British pence', ZAc: 'South African cents', ILA: 'Israeli agorot' };
let currencyNames = null;

export function currencyName(code) {
  if (!code) return '';
  if (SUBUNIT_NAMES[code]) return SUBUNIT_NAMES[code];
  try {
    currencyNames ??= new Intl.DisplayNames(['en'], { type: 'currency' });
    const name = currencyNames.of(code);
    return name && name !== code ? name : '';
  } catch {
    return '';
  }
}

export function amountText(n) {
  if (!(n > 0)) return '';
  const digits = n < 1 ? 4 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
}

function formatter(currency, digits) {
  const key = currency + ':' + digits;
  if (cache.has(key)) return cache.get(key);

  let made;
  try {
    made = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    made = null; // Unknown code: caller falls back to a plain number.
  }
  cache.set(key, made);
  return made;
}

function plain(n, digits) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function format(n, currency, digits) {
  if (n == null || Number.isNaN(n)) return '—';

  const subunit = SUBUNIT[currency];
  if (subunit) return plain(n, digits) + subunit;

  if (!currency) return plain(n, digits); // Deliberately unitless.

  const intl = formatter(currency, digits);
  return intl ? intl.format(n) : plain(n, digits) + ' ' + currency;
}

/** A price, to the cent. Pass the quote's own currency. */
export const money = (n, currency = 'USD') => format(n, currency, 2);

/**
 * The one currency a set of quotes shares, or null when they disagree.
 *
 * Used to decide whether a hypothetical amount — "what would 10,000 become" —
 * can carry a currency symbol at all. Across a mixed watchlist it cannot.
 */
export function sharedCurrency(values) {
  const seen = new Set(
    (values ?? []).map((v) => (typeof v === 'string' ? v : v?.currency)).filter(Boolean),
  );
  return seen.size === 1 ? [...seen][0] : null;
}

export const signedPct = (n) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export const signedMoney = (n, currency = 'USD') =>
  n == null ? '—' : `${n >= 0 ? '+' : '−'}${money(Math.abs(n), currency)}`;

export function compact(n) {
  if (n == null) return '—';
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    // Trim trailing zeros so an axis reads "$10K", not "$10.00K".
    if (Math.abs(n) >= size) return `${(n / size).toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
  }
  return n.toLocaleString('en-US');
}

/** Intraday ranges want a clock; multi-year ranges want just the year context. */
export function axisLabel(ts, range) {
  const d = new Date(ts);
  if (range === '1d') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (range === '5d') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (['5y', '10y', 'max'].includes(range)) return String(d.getFullYear());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function tooltipLabel(ts, range) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (range === '1d' || range === '5d') {
    return `${date}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date;
}

/**
 * Trading sessions, per exchange, in that exchange's own local time.
 *
 * Keyed by the IANA zone Yahoo reports on every quote, which is what lets this
 * cover a new market without a table of exchange codes to maintain.
 *
 * Times are minutes past local midnight. `pre` and `post` mark extended hours
 * where they exist, `lunch` the midday close several Asian exchanges keep, and
 * `days` the trading week where it is not Monday to Friday — Tel Aviv runs
 * Sunday to Thursday, and treating it as a Western week would call it closed on
 * its busiest day.
 *
 * Public holidays are not modelled. A holiday reads as open here and simply has
 * no trades behind it.
 */
const SESSIONS = {
  // --- Americas ---
  'America/New_York': { open: 570, close: 960, pre: 240, post: 1200 },
  'America/Toronto': { open: 570, close: 960, pre: 420, post: 1020 },
  'America/Chicago': { open: 570, close: 960 },
  'America/Mexico_City': { open: 510, close: 900 },
  'America/Sao_Paulo': { open: 600, close: 1020 },
  'America/Argentina/Buenos_Aires': { open: 660, close: 1020 },
  'America/Santiago': { open: 570, close: 1000 },

  // --- Europe ---
  'Europe/London': { open: 480, close: 990 },
  'Europe/Dublin': { open: 480, close: 990 },
  'Europe/Lisbon': { open: 480, close: 990 },
  'Europe/Berlin': { open: 540, close: 1050 },
  'Europe/Paris': { open: 540, close: 1050 },
  'Europe/Amsterdam': { open: 540, close: 1050 },
  'Europe/Brussels': { open: 540, close: 1050 },
  'Europe/Madrid': { open: 540, close: 1050 },
  'Europe/Rome': { open: 540, close: 1050 },
  'Europe/Milan': { open: 540, close: 1050 },
  'Europe/Zurich': { open: 540, close: 1050 },
  'Europe/Vienna': { open: 555, close: 1055 },
  'Europe/Stockholm': { open: 540, close: 1050 },
  'Europe/Oslo': { open: 540, close: 1050 },
  'Europe/Copenhagen': { open: 540, close: 1050 },
  'Europe/Helsinki': { open: 600, close: 1110 },
  'Europe/Warsaw': { open: 540, close: 1020 },
  'Europe/Prague': { open: 540, close: 1000 },
  'Europe/Budapest': { open: 540, close: 1020 },
  'Europe/Athens': { open: 615, close: 1020 },
  'Europe/Istanbul': { open: 600, close: 1080 },
  'Europe/Moscow': { open: 600, close: 1129 },

  // --- Asia-Pacific ---
  // Several of these close for lunch, which a single open/close window would
  // report as trading through.
  'Asia/Tokyo': { open: 540, close: 930, lunch: [690, 750] },
  'Asia/Hong_Kong': { open: 570, close: 960, lunch: [720, 780] },
  'Asia/Shanghai': { open: 570, close: 900, lunch: [690, 780] },
  'Asia/Shenzhen': { open: 570, close: 900, lunch: [690, 780] },
  'Asia/Taipei': { open: 540, close: 810 },
  'Asia/Seoul': { open: 540, close: 930 },
  'Asia/Singapore': { open: 540, close: 1020 },
  'Asia/Kuala_Lumpur': { open: 540, close: 1020, lunch: [750, 810] },
  'Asia/Jakarta': { open: 540, close: 950, lunch: [720, 810] },
  'Asia/Bangkok': { open: 600, close: 990, lunch: [750, 870] },
  'Asia/Manila': { open: 570, close: 915 },
  'Asia/Kolkata': { open: 555, close: 930 },
  'Asia/Calcutta': { open: 555, close: 930 },
  'Australia/Sydney': { open: 600, close: 960 },
  'Australia/Melbourne': { open: 600, close: 960 },
  'Pacific/Auckland': { open: 600, close: 1005 },

  // --- Middle East and Africa ---
  // Sunday to Thursday, which is why `days` exists at all.
  'Asia/Jerusalem': { open: 570, close: 1005, days: [0, 1, 2, 3, 4] },
  'Asia/Tel_Aviv': { open: 570, close: 1005, days: [0, 1, 2, 3, 4] },
  'Asia/Riyadh': { open: 600, close: 900, days: [0, 1, 2, 3, 4] },
  'Asia/Dubai': { open: 600, close: 890, days: [0, 1, 2, 3, 4] },
  'Asia/Qatar': { open: 600, close: 795, days: [0, 1, 2, 3, 4] },
  'Africa/Johannesburg': { open: 540, close: 1020 },
  'Africa/Cairo': { open: 600, close: 870, days: [0, 1, 2, 3, 4] },
  'Africa/Lagos': { open: 600, close: 870 },
};

const DEFAULT_ZONE = 'America/New_York';
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * Is the exchange behind this ticker trading right now?
 *
 * Pass the `timezone` from any quote. An unknown zone falls back to New York,
 * which is also what the header shows before a ticker is selected — better a
 * stated default than a blank.
 */
export function marketStatus(now = new Date(), timezone = DEFAULT_ZONE) {
  const zone = SESSIONS[timezone] ? timezone : DEFAULT_ZONE;
  const session = SESSIONS[zone];
  const local = new Date(now.toLocaleString('en-US', { timeZone: zone }));
  const day = local.getDay();
  const minutes = local.getHours() * 60 + local.getMinutes();

  const trades = session.days ?? WEEKDAYS;
  if (!trades.includes(day)) return { open: false, label: 'Market closed — weekend' };

  if (session.pre != null && minutes >= session.pre && minutes < session.open) {
    return { open: false, label: 'Pre-market' };
  }

  if (minutes >= session.open && minutes < session.close) {
    const [lunchFrom, lunchTo] = session.lunch ?? [];
    if (lunchFrom != null && minutes >= lunchFrom && minutes < lunchTo) {
      return { open: false, label: 'Midday break' };
    }
    return { open: true, label: 'Market open' };
  }

  if (session.post != null && minutes >= session.close && minutes < session.post) {
    return { open: false, label: 'After hours' };
  }

  return { open: false, label: 'Market closed' };
}

/** Yahoo's raw quoteType strings are shouty; show something readable. */
export const typeLabel = (type) =>
  ({ EQUITY: 'Stock', ETF: 'ETF', MUTUALFUND: 'Fund', INDEX: 'Index' })[type] ?? type;

/** Whole units — projected values are estimates, so decimals are false precision. */
export const money0 = (n, currency = 'USD') => format(n, currency, 0);
