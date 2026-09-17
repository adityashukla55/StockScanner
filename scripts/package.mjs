/**
 * Turn the Vite build into one uploadable archive per store.
 *
 * The two browsers disagree about exactly one thing that matters here: how a
 * background script is declared. Chrome's Manifest V3 requires a service
 * worker; Firefox's uses an event page and rejects `service_worker`. Everything
 * else — permissions, the page, the code — is identical, so the build runs once
 * and only the manifest is rewritten.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zip } from './zip.mjs';

const DIST = 'dist';
const OUT = 'build';

// Firefox needs a stable id to sign against, and this one must match whatever
// the add-on is first submitted under.
// Permanent once AMO accepts the first submission — it is how Mozilla knows
// an update is the same add-on. Conventionally an email-shaped string at a
// domain you control; this uses the site's.
const GECKO_ID = 'stock-scanner@stockscanner.pages.dev';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(DIST);
const base = readFileSync(join(DIST, 'manifest.json'), 'utf8');

const manifests = {
  chrome: JSON.parse(base),
  firefox: (() => {
    const m = JSON.parse(base);
    delete m.background.service_worker;
    // Firefox MV3 runs the background as a non-persistent event page.
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // 115 is the first release with storage.session, which background.js uses.
        strict_min_version: '115.0',
        /**
         * What the add-on collects and sends anywhere for storage or processing.
         *
         * Mandatory for new submissions to addons.mozilla.org since 3 November
         * 2025, and Firefox shows it to the user at install time.
         *
         * `none` is the whole answer here, and it is the literal truth rather
         * than a modest reading of the rules: the only outbound requests are the
         * ticker symbols sent to Yahoo to ask for prices, and every watchlist,
         * holding and cost basis stays in browser storage. There is no server to
         * receive anything and no analytics of any kind.
         */
        data_collection_permissions: { required: ['none'] },
      },
    };
    return m;
  })(),
};

mkdirSync(OUT, { recursive: true });

for (const [target, manifest] of Object.entries(manifests)) {
  const entries = files.map((file) => {
    const name = relative(DIST, file).split(sep).join('/');
    return {
      name,
      data: name === 'manifest.json'
        ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
        : readFileSync(file),
    };
  });

  const out = join(OUT, `stock-scanner-${target}-${manifest.version}.zip`);
  const archive = zip(entries);
  writeFileSync(out, archive);
  console.log(`${out}  ${(archive.length / 1024).toFixed(1)} KB  ${entries.length} files`);
}
