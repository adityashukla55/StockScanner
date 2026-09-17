/**
 * Capture screenshots of the dashboard for the landing page.
 *
 * Runs against the dev server. Driving the real unpacked extension would be
 * better — company profiles and implied volatility need Yahoo's crumb-gated
 * endpoints, which want the browser's own cookie jar — but Chrome's headless
 * mode does not load extensions at all, and a visible browser window opening on
 * someone's desktop is a poor trade for two panels.
 *
 * The viewport is therefore cut above the profile panel, so a dev-only failure
 * never reaches a marketing screenshot.
 *
 *   npm install --no-save puppeteer-core
 *   npm run dev            # dev server + Yahoo proxy
 *   npm run screenshots
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// Forward slashes on purpose: Node accepts them on Windows, and a backslash
// path in a single-quoted string silently loses every separator to escaping.
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5320/';
const OUT = process.argv[2] ?? '.';

// A watchlist that spans three currencies, so the shots show the thing the
// single-market version could not do.
const STATE = {
  watchlist: ['SPY', 'AAPL', 'NVDA', 'SAP.DE', 'RELIANCE.NS', 'BP.L'],
  compare: ['AAPL', 'NVDA', 'SAP.DE', 'RELIANCE.NS'],
  picks: ['AAPL', 'NVDA', 'SPY', 'SAP.DE'],
  holdings: [
    { symbol: 'AAPL', shares: 25, cost: 181.4 },
    { symbol: 'NVDA', shares: 40, cost: 96.2 },
    { symbol: 'SPY', shares: 12, cost: 512 },
    { symbol: 'SAP.DE', shares: 30, cost: 142.5 },
    { symbol: 'RELIANCE.NS', shares: 120, cost: 1105 },
  ],
  theme: 'light',
};

const TABS = ['Detail', 'Compare', 'Portfolio', 'Projection', 'Allocation'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // 880 rather than 940: the company profile panel sits just below that line and
  // cannot load on localhost, so the frame ends before it.
  defaultViewport: { width: 1440, height: 880, deviceScaleFactor: 1.5 },
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});


const page = await browser.newPage();

// Seed before the app boots. On the dev server the storage shim writes through
// to localStorage, so this is the key it will read back.
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate((state) => {
  localStorage.setItem('dev:sync:state', JSON.stringify(state));
}, STATE);

await page.goto(URL, { waitUntil: 'networkidle2' });
await wait(9000); // Quotes, candles and the profile panel all land in this window.

for (const tab of TABS) {
  const clicked = await page.evaluate((name) => {
    const button = [...document.querySelectorAll('nav.views button')].find((b) =>
      b.textContent.trim().startsWith(name),
    );
    if (!button) return false;
    button.click();
    return true;
  }, tab);

  if (!clicked) {
    console.log(`  ${tab}: button not found`);
    continue;
  }

  // Projections fit a model per ticker and take the longest.
  await wait(tab === 'Detail' ? 5000 : 12000);

  const file = `${OUT}/shot-${tab.toLowerCase()}.png`;
  await page.screenshot({ path: file, captureBeyondViewport: false });
  console.log(`  ${tab} -> ${file}`);
}

await browser.close();
console.log('done');
