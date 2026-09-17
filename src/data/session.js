/**
 * Yahoo session: the cookie and crumb that option chains require.
 *
 * The server version read `Set-Cookie` off the response and set `Cookie` by
 * hand. A browser forbids both — they are on the list of headers script may not
 * touch — so this leans on the browser's own cookie jar instead: `credentials:
 * 'include'` lets the jar collect Yahoo's cookie on the first call and present
 * it on the next. The extension's host permissions are what make that legal
 * cross-origin; a normal page could not do it.
 *
 * `User-Agent` is likewise not ours to set, and that is an improvement: the
 * browser sends its real one, which is exactly what Yahoo expects to see.
 */
import { FC, Q1 } from './hosts.js';

const SESSION_TTL = 30 * 60_000;

let session = null;

async function mint() {
  // Sets the cookie in the browser's jar as a side effect. It can fail
  // harmlessly — what matters is whether the crumb call below succeeds.
  await fetch(FC, { credentials: 'include' }).catch(() => {});

  const crumbRes = await fetch(`${Q1}/v1/test/getcrumb`, {
    credentials: 'include',
    signal: AbortSignal.timeout(12000),
  });
  const crumb = (await crumbRes.text()).trim();

  // A crumb is a short opaque token; HTML here means a consent redirect, and
  // every later call would fail confusingly.
  if (!crumb || crumb.length > 32 || crumb.includes('<')) {
    throw new Error('Could not obtain a Yahoo crumb');
  }

  session = { crumb, expires: Date.now() + SESSION_TTL };
  return session;
}

async function yahooSession(force = false) {
  if (!force && session && session.expires > Date.now()) return session;
  return mint();
}

export async function authedJson(buildUrl, force = false) {
  const { crumb } = await yahooSession(force);
  const res = await fetch(buildUrl(crumb), {
    credentials: 'include',
    signal: AbortSignal.timeout(12000),
  });

  // A stale crumb reads as a permission failure; mint a new one and retry once.
  if ((res.status === 401 || res.status === 403) && !force) {
    return authedJson(buildUrl, true);
  }
  return { res, json: await res.json() };
}
