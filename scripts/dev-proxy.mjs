/**
 * A CORS proxy for `npm run dev`, and nothing else.
 *
 * The extension reaches Yahoo because host permissions exempt it from CORS. A
 * page on localhost has no such exemption, so the dev server — useful for
 * working on layout without reloading the extension after every change — would
 * otherwise render an app that cannot load a single price.
 *
 * It also keeps a cookie jar. Yahoo's `quoteSummary` and option-chain endpoints
 * are crumb-gated: you fetch a cookie from fc.yahoo.com, exchange it for a
 * crumb, and present both. A browser does that itself, but only for requests it
 * sends to Yahoo directly — proxied through here, the cookie has to live on
 * this side or company profiles and implied volatility fail while everything
 * else works, which is a confusing way to lose two features.
 *
 * Never bundled, never shipped: the built extension talks to Yahoo directly.
 */
import { createServer } from 'node:http';

const PORT = 5310;
const UPSTREAM = {
  '/q1': 'https://query1.finance.yahoo.com',
  '/q2': 'https://query2.finance.yahoo.com',
  '/fc': 'https://fc.yahoo.com',
};

/** name -> value, shared across every request this process forwards. */
const jar = new Map();

function remember(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

const cookieHeader = () =>
  [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  const prefix = Object.keys(UPSTREAM).find((p) => req.url.startsWith(p));
  if (!prefix) {
    res.writeHead(404, cors);
    return res.end('unknown upstream');
  }

  const target = UPSTREAM[prefix] + req.url.slice(prefix.length);
  const headers = { Accept: 'application/json' };
  if (jar.size) headers.Cookie = cookieHeader();

  try {
    const upstream = await fetch(target, { headers, redirect: 'follow' });
    remember(upstream);
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      ...cors,
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(502, cors);
    res.end(JSON.stringify({ error: String(err) }));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`dev proxy -> Yahoo on http://127.0.0.1:${PORT} (with cookie jar)`);
});
