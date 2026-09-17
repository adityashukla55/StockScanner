/**
 * Company and fund profiles: what a stock's business actually is, and what an
 * ETF actually holds.
 *
 * quoteSummary needs a crumb-authenticated session; see session.js.
 */

import { authedJson } from './session.js';
import { Q1 } from './hosts.js';

const MODULES = 'assetProfile,topHoldings,fundProfile,summaryProfile';
const CACHE_TTL = 12 * 60 * 60_000; // Profiles change rarely; holdings monthly at most.

const cache = new Map();

async function fetchSummary(symbol) {
  const { res, json } = await authedJson(
    (crumb) =>
      `${Q1}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=${encodeURIComponent(MODULES)}&crumb=${encodeURIComponent(crumb)}`,
  );

  if (json?.quoteSummary?.error) {
    const err = new Error(json.quoteSummary.error.description || 'No profile available');
    err.status = res.status === 404 ? 404 : 502;
    throw err;
  }
  return json?.quoteSummary?.result?.[0] ?? null;
}

const num = (field) => (field && typeof field.raw === 'number' ? field.raw : null);

const SECTOR_NAMES = {
  realestate: 'Real estate',
  consumer_cyclical: 'Consumer cyclical',
  basic_materials: 'Basic materials',
  consumer_defensive: 'Consumer defensive',
  technology: 'Technology',
  communication_services: 'Communication services',
  financial_services: 'Financial services',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
};

export async function profile(symbol) {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const result = await fetchSummary(key);
  if (!result) {
    const err = new Error(`No profile available for ${key}`);
    err.status = 404;
    throw err;
  }

  const asset = result.assetProfile ?? result.summaryProfile ?? {};
  const top = result.topHoldings ?? null;
  const fund = result.fundProfile ?? null;

  const holdings = (top?.holdings ?? [])
    .map((h) => ({
      symbol: h.symbol ?? null,
      name: h.holdingName ?? h.symbol ?? '',
      weight: num(h.holdingPercent),
    }))
    .filter((h) => h.weight != null);

  const sectors = (top?.sectorWeightings ?? [])
    .map((entry) => {
      const [rawName, value] = Object.entries(entry)[0] ?? [];
      return { name: SECTOR_NAMES[rawName] ?? rawName, weight: num(value) };
    })
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  const value = {
    symbol: key,
    summary: asset.longBusinessSummary ?? null,
    sector: asset.sector ?? null,
    industry: asset.industry ?? null,
    employees: asset.fullTimeEmployees ?? null,
    website: asset.website ?? null,
    country: asset.country ?? null,
    // Present only for funds and ETFs.
    fund:
      fund || holdings.length
        ? {
            family: fund?.family ?? null,
            category: fund?.categoryName ?? null,
            legalType: fund?.legalType ?? null,
            expenseRatio:
              num(fund?.feesExpensesInvestment?.annualReportExpenseRatio) ??
              num(fund?.feesExpensesInvestment?.netExpRatio),
            holdings,
            sectors,
            // Yahoo exposes only the top ten; say so rather than implying it's all.
            holdingsAreTopTen: holdings.length > 0,
          }
        : null,
    yahooUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(key)}`,
  };

  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

