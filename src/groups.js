import { MARKETS, suffixOf } from './markets.js';

export const MAX_GROUPS = 30;
export const MAX_GROUP_NAME = 40;

export const newGroupId = () =>
  `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function uniqueGroupName(groups, base = 'New group') {
  const taken = new Set(groups.map((g) => g.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

export function countryOf(symbol) {
  const suffix = suffixOf(symbol).toUpperCase();
  return MARKETS.find((m) => m.suffixes?.some((s) => s.toUpperCase() === suffix)) ?? null;
}

export function quickAddOptions(symbols, quotes) {
  const countries = new Map();
  const currencies = new Map();

  for (const symbol of symbols) {
    const market = countryOf(symbol);
    if (market) {
      if (!countries.has(market.key)) {
        countries.set(market.key, { key: `country:${market.key}`, label: `${market.flag} ${market.label}`, symbols: [] });
      }
      countries.get(market.key).symbols.push(symbol);
    }

    const currency = quotes[symbol]?.currency;
    if (currency) {
      if (!currencies.has(currency)) {
        currencies.set(currency, { key: `currency:${currency}`, label: currency, symbols: [] });
      }
      currencies.get(currency).symbols.push(symbol);
    }
  }

  return [...countries.values(), ...currencies.values()];
}

export function addMissing(list, extra) {
  const add = [...new Set(extra)].filter((s) => !list.includes(s));
  return add.length ? [...list, ...add] : list;
}
