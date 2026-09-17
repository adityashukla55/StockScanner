/**
 * The markets you can follow, and how to recognise a listing on one.
 *
 * Yahoo identifies a market by the suffix on the ticker — `SAP.DE` is XETRA,
 * `RELIANCE.NS` is the NSE — with US listings carrying none at all. That is the
 * whole basis for filtering search results here: no exchange code table to keep
 * current, and a market you have not heard of still resolves, it simply is not
 * one of the presets.
 *
 * `zone` is the IANA timezone the header clock reads when this market is the
 * one being followed. It matches what Yahoo reports on a quote from it.
 */
export const MARKETS = [
  { key: 'all', label: 'All markets', flag: '🌍', zone: null, suffixes: null },
  { key: 'us', label: 'United States', flag: '🇺🇸', zone: 'America/New_York', suffixes: [''] },
  { key: 'in', label: 'India', flag: '🇮🇳', zone: 'Asia/Kolkata', suffixes: ['.NS', '.BO'] },
  { key: 'uk', label: 'United Kingdom', flag: '🇬🇧', zone: 'Europe/London', suffixes: ['.L', '.IL'] },
  { key: 'de', label: 'Germany', flag: '🇩🇪', zone: 'Europe/Berlin', suffixes: ['.DE', '.F', '.BE', '.HM', '.MU', '.SG', '.DU'] },
  { key: 'fr', label: 'France', flag: '🇫🇷', zone: 'Europe/Paris', suffixes: ['.PA'] },
  { key: 'nl', label: 'Netherlands', flag: '🇳🇱', zone: 'Europe/Amsterdam', suffixes: ['.AS'] },
  { key: 'ch', label: 'Switzerland', flag: '🇨🇭', zone: 'Europe/Zurich', suffixes: ['.SW', '.VX'] },
  { key: 'es', label: 'Spain', flag: '🇪🇸', zone: 'Europe/Madrid', suffixes: ['.MC'] },
  { key: 'it', label: 'Italy', flag: '🇮🇹', zone: 'Europe/Rome', suffixes: ['.MI'] },
  { key: 'se', label: 'Sweden', flag: '🇸🇪', zone: 'Europe/Stockholm', suffixes: ['.ST'] },
  { key: 'ca', label: 'Canada', flag: '🇨🇦', zone: 'America/Toronto', suffixes: ['.TO', '.V', '.CN', '.NE'] },
  { key: 'au', label: 'Australia', flag: '🇦🇺', zone: 'Australia/Sydney', suffixes: ['.AX'] },
  { key: 'jp', label: 'Japan', flag: '🇯🇵', zone: 'Asia/Tokyo', suffixes: ['.T'] },
  { key: 'hk', label: 'Hong Kong', flag: '🇭🇰', zone: 'Asia/Hong_Kong', suffixes: ['.HK'] },
  { key: 'sg', label: 'Singapore', flag: '🇸🇬', zone: 'Asia/Singapore', suffixes: ['.SI'] },
  { key: 'kr', label: 'South Korea', flag: '🇰🇷', zone: 'Asia/Seoul', suffixes: ['.KS', '.KQ'] },
  { key: 'br', label: 'Brazil', flag: '🇧🇷', zone: 'America/Sao_Paulo', suffixes: ['.SA'] },
  { key: 'za', label: 'South Africa', flag: '🇿🇦', zone: 'Africa/Johannesburg', suffixes: ['.JO'] },
];

const BY_KEY = new Map(MARKETS.map((m) => [m.key, m]));

export const marketFor = (key) => BY_KEY.get(key) ?? MARKETS[0];

/** The suffix on a ticker, or '' for a US listing. */
export function suffixOf(symbol) {
  const dot = String(symbol ?? '').lastIndexOf('.');
  return dot === -1 ? '' : symbol.slice(dot);
}

/**
 * Does this symbol belong to the market being followed?
 *
 * 'All markets' accepts everything. A US filter is the awkward one: its
 * "suffix" is the absence of one, so it has to reject anything dotted rather
 * than match a list.
 */
export function inMarket(symbol, key) {
  const market = marketFor(key);
  if (!market.suffixes) return true;

  const suffix = suffixOf(symbol).toUpperCase();
  return market.suffixes.some((s) => s.toUpperCase() === suffix);
}
