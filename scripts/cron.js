// scripts/cron.js
// Standalone cron trigger - the CLI equivalent of POST /api/cron/scrape.
//
// Usage:
//   node scripts/cron.js                       # POST to the running API
//   node scripts/cron.js --url http://localhost:5000
//   node scripts/cron.js --store 876           # only this store product
//   node scripts/cron.js --direct              # no server needed: runs the
//                                              # batch in-process against the DB
//   node scripts/cron.js --direct --secret x   # sends x-cron-secret if needed
//
// Schedule with Windows Task Scheduler / cron:
//   */30 * * * *  cd /path/to/project && node scripts/cron.js

const config = require('../src/config');

function parseArgs(argv) {
  const args = { direct: false, url: `http://localhost:${config.port}`, store: null, timeoutMs: 600000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--direct') args.direct = true;
    else if (arg === '--url') args.url = argv[++i];
    else if (arg === '--store') args.store = argv[++i];
    else if (arg === '--timeout') args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
  }
  return args;
}

async function runDirect(storeIds) {
  // .env is already loaded through src/config.
  const { repo } = require('../src/db');
  const scrapeService = require('../src/scrapeService');

  const products = await repo.listProducts();
  console.log(`[cron:direct] ${products.length} tracked product(s) in the database.`);
  if (!products.length) {
    console.log('[cron:direct] nothing to scrape.');
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  const summary = await scrapeService.runBatch({ products, storeIds });
  for (const r of summary.results) {
    console.log(
      `  - ${r.name ?? r.storeId}: ${r.status} (${r.attempts} attempt(s))` +
        (r.ok ? ` price=${r.price} stock=${r.stock}` : ` error=${r.lastError || r.error}`)
    );
  }
  console.log(
    `[cron:direct] done: ${summary.succeeded}/${summary.total} succeeded in ${summary.durationMs}ms`
  );
  return summary;
}

async function runViaApi({ url, store, timeoutMs }) {
  const endpoint = `${url.replace(/\/+$/, '')}/api/cron/scrape`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  console.log(`[cron:api] POST ${endpoint}`);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.cron.secret ? { 'x-cron-secret': config.cron.secret } : {}),
      },
      body: JSON.stringify(store ? { storeIds: [Number(store)] } : {}),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    if (!res.ok) {
      console.error(`[cron:api] HTTP ${res.status}:`, payload.error || payload);
      process.exitCode = 1;
      return payload;
    }

    console.log(
      `[cron:api] ${payload.succeeded}/${payload.total} succeeded, ` +
        `${payload.failed} failed in ${payload.durationMs}ms`
    );
    for (const r of payload.results || []) {
      console.log(
        `  - ${r.name ?? r.storeId}: ${r.status} (${r.attempts} attempt(s))` +
          (r.ok ? ` price=${r.price} stock=${r.stock}` : ` error=${r.lastError}`)
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storeIds = args.store ? [Number(args.store)] : null;

  const payload = args.direct ? await runDirect(storeIds) : await runViaApi(args);
  if (payload && payload.failed) process.exitCode = 1;
  return payload;
}

main().catch((err) => {
  console.error('[cron] fatal:', err.message);
  process.exitCode = 1;
});
