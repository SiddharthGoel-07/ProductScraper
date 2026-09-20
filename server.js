// server.js
// Product Price Tracker API - Express, port 5000.
//
// Routes (assignment requirements in bold):
//   GET    /api/health            - status of store/db wiring
//   **GET  /api/search?q=...**    - proxies scraper.searchCatalog(q)
//   **POST /api/track**           - insert product + first price scrape + logs
//   **GET  /api/dashboard**       - tracked products + latest price/stock + last 10 logs
//   **POST /api/cron/scrape**     - re-scrape every tracked product
//   GET    /api/products/:id      - product detail (history + logs + stats)
//   DELETE /api/products/:id      - stop tracking a product
//
// NOTE: scraper.js is imported, never modified.

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const config = require('./src/config');
const { repo, isSupabase } = require('./src/db');
const scrapeService = require('./src/scrapeService');
// Imported only so the contract is explicit: BASE_URL comes from scraper.js.
const { BASE_URL } = require('./scraper.js');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ------------------------------- helpers ------------------------------------

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function statsFor(history) {
  const prices = history.map((row) => toNumber(row.price)).filter((n) => n !== null);
  if (!prices.length) return { points: 0, min: null, max: null, avg: null, changePct: null };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((sum, n) => sum + n, 0) / prices.length;
  const first = prices[0];
  const last = prices[prices.length - 1];
  const changePct = first ? Number((((last - first) / first) * 100).toFixed(2)) : null;
  return {
    points: prices.length,
    min,
    max,
    avg: Number(avg.toFixed(2)),
    changePct,
  };
}

function summariseLogs(logs) {
  return logs.reduce(
    (acc, log) => {
      const status = String(log.status || '').toLowerCase();
      if (status === 'success') acc.success += 1;
      else if (status === 'retried') acc.retried += 1;
      else acc.failed += 1;
      return acc;
    },
    { success: 0, retried: 0, failed: 0 }
  );
}

function serialiseProduct(product, { latest, logs = [], history = null, currency } = {}) {
  const latestRow = latest || null;
  return {
    id: product.id,
    store_id: product.store_id,
    name: product.name,
    sku: product.sku,
    latest: latestRow
      ? {
          price: toNumber(latestRow.price),
          stock: toNumber(latestRow.stock),
          scraped_at: latestRow.scraped_at,
        }
      : { price: null, stock: null, scraped_at: null },
    lastLog: logs.length ? logs[0] : null,
    logs,
    logSummary: summariseLogs(logs),
    currency: currency || config.defaultCurrency,
    ...(history
      ? {
          history: history.map((row) => ({
            price: toNumber(row.price),
            stock: toNumber(row.stock),
            scraped_at: row.scraped_at,
          })),
          stats: statsFor(history),
        }
      : {}),
  };
}

// -------------------------------- routes ------------------------------------

app.get('/api/health', asyncRoute(async (req, res) => {
  let dbOk = true;
  let dbError = null;
  try {
    await repo.ping();
  } catch (err) {
    dbOk = false;
    dbError = err.message;
  }

  res.json({
    ok: dbOk,
    service: 'ine-price-tracker-api',
    storeBaseUrl: BASE_URL,
    database: {
      driver: repo.kind,
      isSupabase,
      configured: config.supabase.configured,
      reason: config.supabase.reason,
      reachable: dbOk,
      error: dbError,
    },
    logGranularity: config.scraping.logGranularity,
    cron: {
      delayMs: config.cron.delayMs,
      secretRequired: Boolean(config.cron.secret),
      schedulerEnabled: config.cron.enableScheduler,
      schedule: config.cron.enableScheduler ? config.cron.schedule : null,
    },
    uptimeSeconds: Number(process.uptime().toFixed(1)),
  });
}));

// GET /api/search?q=... -> scraper.searchCatalog(q)
app.get('/api/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) throw httpError(400, 'Query parameter "q" is required, e.g. /api/search?q=boot');

  const maxPages = req.query.maxPages !== undefined ? toNumber(req.query.maxPages, config.search.maxPages) : undefined;
  const startedAt = Date.now();
  const { results, cached } = await scrapeService.searchCatalog(q, { maxPages });
  const tracked = await repo.listProducts();
  const trackedIds = new Set(tracked.map((p) => Number(p.store_id)));

  res.json({
    query: q,
    count: results.length,
    cached,
    durationMs: Date.now() - startedAt,
    results: results.map((item) => ({
      id: item.id,
      storeId: item.id, // catalog id IS the store product id used by scrapePrice
      name: item.name,
      brand: item.brand ?? null,
      category: item.category ?? null,
      sku: item.sku ?? null,
      price: toNumber(item.price),
      stock: toNumber(item.stock),
      tracked: trackedIds.has(Number(item.id)),
      trackedProductId: tracked.find((p) => Number(p.store_id) === Number(item.id))?.id ?? null,
    })),
  });
}));

// POST /api/track  { storeId, name, sku }
// Inserts the product, runs a first price scrape (price_history + scrape_logs)
// and returns the created product together with the scrape outcome.
app.post('/api/track', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const storeId = toNumber(body.storeId ?? body.store_id, null);
  const name = body.name != null ? String(body.name).trim() : '';
  const sku = body.sku != null && String(body.sku).trim() !== '' ? String(body.sku).trim() : null;
  const force = body.force === true || req.query.force === 'true';

  if (storeId === null || !Number.isInteger(storeId) || storeId <= 0) {
    throw httpError(400, 'Body field "storeId" must be a positive integer.');
  }
  if (!name) throw httpError(400, 'Body field "name" is required.');

  const existing = await repo.getProductByStoreId(storeId);
  if (existing && !force) {
    // Idempotent-ish: tell the UI it is already tracked instead of duplicating.
    return res.status(409).json({
      error: 'Product is already tracked.',
      alreadyTracked: true,
      product: { id: existing.id, store_id: existing.store_id, name: existing.name, sku: existing.sku },
    });
  }

  const product = existing || (await repo.createProduct({ store_id: storeId, name, sku }));

  // First scrape immediately so the dashboard has data right after tracking.
  const scrape = await scrapeService.scrapeAndPersist(product);
  const history = await repo.listPriceHistory(product.id, { limit: 500, ascending: true });
  const logs = await repo.listScrapeLogs(product.id, { limit: 10 });
  const latest = [...history].reverse()[0] || null;

  res.status(existing ? 200 : 201).json({
    ...serialiseProduct(product, { latest, logs, history, currency: scrape.currency }),
    scrape: {
      ok: scrape.ok,
      status: scrape.status,
      attempts: scrape.attempts,
      durationMs: scrape.durationMs,
      price: scrape.price,
      mrp: scrape.mrp,
      stock: scrape.stock,
      scrapedAt: scrape.scrapedAt,
      lastError: scrape.lastError,
      attemptTrail: scrape.attemptTrail,
    },
  });
}));

// GET /api/dashboard -> tracked products + latest price/stock + last 10 logs
app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const logLimit = Math.min(Math.max(toNumber(req.query.logLimit, 10) ?? 10, 1), 50);
  const products = await repo.listProducts();

  if (!products.length) {
    return res.json({
      count: 0,
      currency: config.defaultCurrency,
      generatedAt: new Date().toISOString(),
      logLimit,
      products: [],
    });
  }

  const ids = products.map((p) => p.id);
  const latestPrices = await repo.listLatestPrices(ids);
  const logsByProduct = await repo.listScrapeLogsForProducts(ids, { perProduct: logLimit });

  const rows = products.map((product) =>
    serialiseProduct(product, {
      latest: latestPrices[product.id] || null,
      logs: logsByProduct[product.id] || [],
    })
  );

  res.json({
    count: rows.length,
    currency: config.defaultCurrency,
    generatedAt: new Date().toISOString(),
    logLimit,
    products: rows,
  });
}));

// --------------------------- POST /api/cron/scrape ---------------------------
// Re-scrapes every tracked product. Intended to be hit by an external cron
// (Windows Task Scheduler / GitHub Action / Vercel cron / `node scripts/cron.js`).
// GET is also accepted so the endpoint can be triggered from a browser.

let cronRunning = false;

function assertCronAuthorised(req) {
  if (!config.cron.secret) return;
  const provided = req.get('x-cron-secret') || req.query.secret || '';
  if (provided !== config.cron.secret) {
    throw httpError(401, 'Invalid or missing cron secret (x-cron-secret header).');
  }
}

async function handleCronScrape(req, res) {
  assertCronAuthorised(req);

  if (cronRunning) {
    throw httpError(409, 'A cron scrape is already in progress. Try again shortly.');
  }

  cronRunning = true;
  const startedAt = Date.now();
  try {
    const products = await repo.listProducts();

    if (!products.length) {
      return res.json({
        ok: true,
        message: 'No tracked products - nothing to scrape.',
        total: 0,
        succeeded: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
        results: [],
      });
    }

    // Optional subset: {"storeIds":[876,478]} or ?store=876 / ?storeIds=876,478
    const rawFilter = (req.body && req.body.storeIds) ?? req.query.storeIds ?? req.query.store ?? null;
    const storeFilter = rawFilter
      ? (Array.isArray(rawFilter) ? rawFilter : String(rawFilter).split(','))
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : null;

    const summary = await scrapeService.runBatch({
      products,
      storeIds: storeFilter && storeFilter.length ? storeFilter : null,
    });
    res.json({
      ok: summary.failed === 0,
      durationMs: Date.now() - startedAt,
      ...summary,
      storeIds: storeFilter && storeFilter.length ? storeFilter : null,
      results: summary.results.map((r) => ({
        productId: r.productId,
        storeId: r.storeId,
        name: r.name,
        ok: r.ok,
        status: r.status,
        attempts: r.attempts,
        price: r.price ?? null,
        stock: r.stock ?? null,
        scrapedAt: r.scrapedAt ?? null,
        lastError: r.lastError ?? r.error ?? null,
      })),
    });
  } finally {
    cronRunning = false;
  }
}

app.post('/api/cron/scrape', asyncRoute(handleCronScrape));
app.get('/api/cron/scrape', asyncRoute(handleCronScrape));

// ---------------------- GET /api/products/:id (detail view) ------------------

app.get('/api/products/:id', asyncRoute(async (req, res) => {
  const product = await repo.getProductById(req.params.id);
  if (!product) throw httpError(404, `Product ${req.params.id} is not tracked.`);

  const historyLimit = Math.min(Math.max(toNumber(req.query.historyLimit, 200) ?? 200, 1), 1000);
  const logLimit = Math.min(Math.max(toNumber(req.query.logLimit, 10) ?? 10, 1), 100);

  const history = await repo.listPriceHistory(product.id, {
    limit: historyLimit,
    ascending: true,
  });
  const logs = await repo.listScrapeLogs(product.id, { limit: logLimit });
  const latest = history.length ? history[history.length - 1] : null;

  res.json(serialiseProduct(product, { latest, logs, history }));
}));

// ------------------- DELETE /api/products/:id (stop tracking) ---------------

app.delete('/api/products/:id', asyncRoute(async (req, res) => {
  const product = await repo.getProductById(req.params.id);
  if (!product) throw httpError(404, `Product ${req.params.id} is not tracked.`);
  await repo.deleteProduct(product.id);
  res.status(204).end();
}));

// --------------------- optional: serve the built React app -------------------
// `npm --prefix client run build` then http://localhost:5000 serves the SPA too.
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  console.log(`[server] Serving built client from ${clientDist}`);
}

// ----------------------------- error handling --------------------------------

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(err.alreadyTracked ? { alreadyTracked: true } : {}),
    ...(err.product ? { product: err.product } : {}),
  });
});

// ------------------------ in-process cron (optional) -------------------------
// Off by default; enable with ENABLE_CRON_SCHEDULER=true (+ CRON_SCHEDULE).
function startScheduler() {
  let cron;
  try {
    // eslint-disable-next-line global-require
    cron = require('node-cron');
  } catch {
    console.error('[cron] node-cron is not installed - skipping in-process scheduler.');
    return null;
  }

  if (!cron.validate(config.cron.schedule)) {
    console.error(`[cron] Invalid CRON_SCHEDULE "${config.cron.schedule}" - scheduler not started.`);
    return null;
  }

  const task = cron.schedule(config.cron.schedule, async () => {
    if (cronRunning) {
      console.warn('[cron] previous run still in progress - skipping this tick.');
      return;
    }
    cronRunning = true;
    const startedAt = Date.now();
    try {
      const products = await repo.listProducts();
      const summary = await scrapeService.runBatch({ products });
      console.log(
        `[cron] ${new Date().toISOString()} scraped ${summary.total} product(s): ` +
          `${summary.succeeded} ok / ${summary.failed} failed in ${Date.now() - startedAt}ms`
      );
    } catch (err) {
      console.error('[cron] batch failed:', err.message);
    } finally {
      cronRunning = false;
    }
  });

  console.log(`[cron] In-process scheduler active: "${config.cron.schedule}"`);
  return task;
}

// --------------------------------- bootstrap ---------------------------------

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`\n[server] Product Price Tracker API listening on http://localhost:${config.port}`);
    console.log(`[server] Store base URL : ${BASE_URL}`);
    console.log(`[server] Database       : ${repo.kind}${isSupabase ? '' : ' (dev shim - see .env)'}`);
    console.log(`[server] scrape_logs    : granularity=${config.scraping.logGranularity}\n`);
    if (config.cron.enableScheduler) startScheduler();
  });
}

module.exports = { app, config, repo, startScheduler, handleCronScrape };
