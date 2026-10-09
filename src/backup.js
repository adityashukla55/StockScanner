import { MARKETS } from './markets.js';
import { sanitize } from './storage.js';
import { addMissing, newGroupId } from './groups.js';

export const APP_ID = 'stock-scanner';
export const BACKUP_VERSION = 1;
const CODE_PREFIX = 'SSB1:';
const MAX_PICKS = 8;

export const SECTIONS = [
  { key: 'watchlist', label: 'Watchlist and groups', tabs: 'Detail, Projection' },
  { key: 'compare', label: 'Compare', tabs: 'Compare' },
  { key: 'portfolio', label: 'Portfolio', tabs: 'Portfolio' },
  { key: 'allocation', label: 'Allocation', tabs: 'Allocation' },
  { key: 'settings', label: 'Theme and market', tabs: 'All tabs' },
];

const count = (list, word) => {
  const n = list?.length ?? 0;
  return `${n} ${n === 1 ? word : `${word}s`}`;
};

export function sectionSummary(key, state, settings) {
  switch (key) {
    case 'watchlist':
      return `${count(state.watchlist, 'ticker')}, ${count(state.groups, 'group')}`;
    case 'compare':
      return count(state.compare, 'ticker');
    case 'portfolio':
      return count(state.holdings, 'holding');
    case 'allocation':
      return count(state.picks, 'ticker');
    case 'settings': {
      const market = MARKETS.find((m) => m.key === settings?.market);
      return [state.theme && `${state.theme} theme`, market && market.label].filter(Boolean).join(', ') || 'defaults';
    }
    default:
      return '';
  }
}

export function buildBackup(state, settings, sections) {
  const clean = sanitize(state);
  const out = {};
  if (sections.includes('watchlist')) {
    out.watchlist = clean.watchlist ?? [];
    out.groups = clean.groups ?? [];
    out.activeGroup = clean.activeGroup;
  }
  if (sections.includes('compare')) out.compare = clean.compare ?? [];
  if (sections.includes('portfolio')) out.holdings = clean.holdings ?? [];
  if (sections.includes('allocation')) out.picks = clean.picks ?? [];
  if (sections.includes('settings')) out.theme = clean.theme;

  return {
    app: APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    state: out,
    settings: sections.includes('settings') ? { market: settings?.market ?? 'all' } : undefined,
  };
}

export const backupFileName = (date = new Date()) =>
  `stock-scanner-backup-${date.toISOString().slice(0, 10)}.json`;

export function downloadBackup(backup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const toBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function backupToText(backup) {
  const json = JSON.stringify(backup);
  if (typeof CompressionStream === 'undefined') return json;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return CODE_PREFIX + toBase64(bytes);
}

async function textToJson(text) {
  const raw = text.trim();
  if (!raw.startsWith(CODE_PREFIX)) return raw;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read backup codes. Use a backup file instead.');
  }
  try {
    const bytes = fromBase64(raw.slice(CODE_PREFIX.length).replace(/\s+/g, ''));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    throw new Error('This backup text is broken or cut short. Copy it again in full.');
  }
}

export async function parseBackup(text) {
  if (!text?.trim()) throw new Error('Nothing to read. Choose a file or paste backup text.');

  let parsed;
  try {
    parsed = JSON.parse(await textToJson(text));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error('This is not a Stock Scanner backup.');
    throw err;
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('This is not a Stock Scanner backup.');
  if (parsed.app === APP_ID && Number(parsed.version) > BACKUP_VERSION) {
    throw new Error('This backup comes from a newer version of Stock Scanner. Update the app first.');
  }

  const body = parsed.app === APP_ID ? parsed.state : parsed;
  const state = sanitize(body);
  const market = parsed.settings?.market;
  const settings = MARKETS.some((m) => m.key === market) ? { market } : null;

  const sections = [];
  if (state.watchlist || state.groups) sections.push('watchlist');
  if (state.compare) sections.push('compare');
  if (state.holdings) sections.push('portfolio');
  if (state.picks) sections.push('allocation');
  if (state.theme || settings) sections.push('settings');
  if (!sections.length) throw new Error('This backup is empty, or not a Stock Scanner backup.');

  return {
    state,
    settings,
    sections,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
  };
}

function mergeGroups(current, incoming) {
  const out = current.map((g) => ({ ...g, symbols: [...g.symbols] }));
  for (const g of incoming) {
    const same = out.find((o) => o.name.trim().toLowerCase() === g.name.trim().toLowerCase());
    if (same) {
      same.symbols = addMissing(same.symbols, g.symbols);
    } else {
      const id = out.some((o) => o.id === g.id) ? newGroupId() : g.id;
      out.push({ ...g, id });
    }
  }
  return out;
}

function mergeHoldings(current, incoming) {
  const out = [...current];
  for (const h of incoming) {
    const i = out.findIndex((o) => o.symbol === h.symbol);
    if (i >= 0) out[i] = { ...h };
    else out.push({ ...h });
  }
  return out;
}

export function applyBackup(current, backup, sections, mode) {
  const incoming = backup.state;
  const replace = mode === 'replace';
  const next = { ...current };

  if (sections.includes('watchlist')) {
    if (replace) {
      next.watchlist = incoming.watchlist ?? [];
      next.groups = incoming.groups ?? [];
      next.activeGroup = incoming.activeGroup ?? null;
    } else {
      next.watchlist = addMissing(current.watchlist ?? [], incoming.watchlist ?? []);
      next.groups = mergeGroups(current.groups ?? [], incoming.groups ?? []);
    }
  }
  if (sections.includes('compare')) {
    next.compare = replace
      ? incoming.compare ?? []
      : addMissing(current.compare ?? [], incoming.compare ?? []).slice(0, MAX_PICKS);
  }
  if (sections.includes('portfolio')) {
    next.holdings = replace
      ? incoming.holdings ?? []
      : mergeHoldings(current.holdings ?? [], incoming.holdings ?? []);
  }
  if (sections.includes('allocation')) {
    next.picks = replace
      ? incoming.picks ?? []
      : addMissing(current.picks ?? [], incoming.picks ?? []).slice(0, MAX_PICKS);
  }
  if (sections.includes('settings') && incoming.theme) next.theme = incoming.theme;

  const clean = sanitize(next);
  const settings = sections.includes('settings') ? backup.settings : null;
  return { state: clean, settings };
}
