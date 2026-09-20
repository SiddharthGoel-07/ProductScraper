// scripts/smoke-test.js
// End-to-end smoke test for the API. Start the server first, then run:
//   node scripts/smoke-test.js
//   node scripts/smoke-test.js --base http://localhost:5000 --query boot
//
// Exits non-zero if any check fails, so it can be wired into CI.

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

const BASE = argValue('--base', 'http://localhost:5000');
const QUERY = argValue('--query', 'boot');
const STORE_ID = argValue('--store', null);

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function request(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* still starting up - keep polling */
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log(`\n=== Smoke test against ${BASE} ===\n`);

  if (!(await waitForServer())) {
    console.error(`Server not reachable at ${BASE}. Start it with: npm start`);
    process.exitCode = 1;
    return;
  }

  // 1. health
  const health = await request('GET', '/api/health');
  record('GET /api/health returns 200', health.status === 200, `db=${health.body?.database?.driver}`);
  record(
    'health reports the INE store base URL',
    String(health.body?.storeBaseUrl || '').includes('inelabteamdev'),
    health.body?.storeBaseUrl
  );

  // 2. search  (first uncached call walks the catalog, allow ~60s)
  const search = await request('GET', `/api/search?q=${encodeURIComponent(QUERY)}`);
  const found = search.body?.results || [];
  record('GET /api/search returns 200', search.status === 200, `${search.body?.count ?? 0} result(s)`);
  record('search results carry an id + name', Boolean(found[0]?.id && found[0]?.name), found[0]?.name);
  record('search results carry a sku', found.length === 0 || Boolean(found[0]?.sku), found[0]?.sku);

  const target = STORE_ID
    ? found.find((r) => String(r.id) === String(STORE_ID)) || { id: Number(STORE_ID), name: `store product ${STORE_ID}` }
    : found[0];

  if (!target) {
    record('a target product exists to track', false, 'no search results');
    return;
  }

  // 3. track  (insert product + first price scrape + scrape_logs)
  const track = await request('POST', '/api/track', {
    storeId: target.id,
    name: target.name,
    sku: target.sku,
  });
  const trackOk = track.status === 201 || (track.status === 409 && track.body?.alreadyTracked);
  record(
    `POST /api/track for storeId=${target.id}`,
    trackOk,
    track.status === 409 ? 'already tracked (re-run)' : `http ${track.status}, scrape=${track.body?.scrape?.status}`
  );

  // 4. duplicate guard
  const dup = await request('POST', '/api/track', { storeId: target.id, name: target.name, sku: target.sku });
  record('POST /api/track rejects duplicates with 409', dup.status === 409, dup.body?.error);

  // 5. validation guard
  const bad = await request('POST', '/api/track', { storeId: 'abc', name: '' });
  record('POST /api/track validates input with 400', bad.status === 400, bad.body?.error);

  // 6. dashboard
  const dash = await request('GET', '/api/dashboard');
  const tracked = dash.body?.products || [];
  const first = tracked.find((p) => String(p.store_id) === String(target.id)) || tracked[0];
  record('GET /api/dashboard returns 200', dash.status === 200, `${dash.body?.count ?? 0} product(s)`);
  record('dashboard includes latest price/stock', Boolean(first && first.latest), JSON.stringify(first?.latest));
  record(
    'dashboard includes up to 10 scrape logs per product',
    Boolean(first && Array.isArray(first.logs) && first.logs.length <= 10),
    `${first?.logs?.length ?? 0} log(s)`
  );
  record(
    'dashboard log statuses are within (success|retried|failed)',
    (first?.logs || []).every((l) => ['success', 'retried', 'failed'].includes(l.status)),
    [...new Set((first?.logs || []).map((l) => l.status))].join(',') || 'n/a'
  );

  // 7. product detail
  if (first?.id) {
    const detail = await request('GET', `/api/products/${first.id}`);
    record(
      'GET /api/products/:id returns 200',
      detail.status === 200,
      `${detail.body?.history?.length ?? 0} price point(s)`
    );
    record('product detail exposes price history', Array.isArray(detail.body?.history));
    record('product detail exposes stats', Boolean(detail.body?.stats));
  }

  await cronChecks(target, first);
}

// --------------------------- cron + accumulation checks ----------------------

async function cronChecks(target, first) {
  // 8. cron: re-scrape every tracked product
  const cron = await request('POST', '/api/cron/scrape');
  record(
    'POST /api/cron/scrape re-scrapes tracked products',
    cron.status === 200 && typeof cron.body?.total === 'number',
    `${cron.body?.succeeded}/${cron.body?.total} ok in ${cron.body?.durationMs}ms`
  );

  // 9. cron store filter
  const filtered = await request('POST', '/api/cron/scrape', { storeIds: [Number(target.id)] });
  record(
    'cron honours the storeIds filter',
    filtered.status === 200 && filtered.body?.total === 1,
    `total=${filtered.body?.total}`
  );

  // 10. price_history must have grown and scrape_logs must be fresh
  if (first?.id) {
    const after = await request('GET', `/api/products/${first.id}`);
    record(
      'price_history accumulated a new point after the cron runs',
      (after.body?.history?.length ?? 0) >= 1,
      `${after.body?.history?.length ?? 0} point(s), latest=${JSON.stringify(after.body?.latest)}`
    );
    record(
      'scrape_logs recorded the cron runs',
      (after.body?.logs?.length ?? 0) >= 1,
      `${after.body?.logs?.length ?? 0} log row(s)`
    );
  }

  // 11. 404 handling
  const missing = await request('GET', '/api/products/00000000-0000-0000-0000-000000000000');
  record('unknown product returns 404', missing.status === 404, missing.body?.error);
}

main()
  .catch((err) => {
    console.error('Smoke test crashed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
    if (failed.length) {
      console.log('Failed checks:');
      for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
      process.exitCode = 1;
    }
  });
