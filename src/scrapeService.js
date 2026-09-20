// src/scrapeService.js
// The ONLY place in this project that calls into scraper.js.
//
// scraper.js is treated as an untouched black box:
//   searchCatalog(query, { maxPages, pageSize }) -> catalog items
//   scrapePrice(storeId, { maxAttempts })        -> { ok, quote, log }
//
// This module adds the assignment's persistence rules on top of it:
//   * a successful scrape  -> one price_history row + scrape_logs row(s)
//   * a failed scrape      -> no price_history row, scrape_logs row(s) only
//   * scraper log statuses are normalised to the schema's
//     'success' | 'retried' | 'failed'

const scraper = require('../scraper.js');
const config = require('./config');
const { repo } = require('./db');

// ------------------------------ helpers -------------------------------------

/**
 * `quote.at` is the store's own epoch-milliseconds timestamp. Prices are
 * stamped with it so the chart reflects when the store quoted the price, not
 * when our HTTP request happened to finish.
 */
function scrapeTimestamp(quote) {
  const at = Number(quote && quote.at);
  if (Number.isFinite(at) && at > 0) {
    const date = new Date(at);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

/**
 * The DB schema only allows success | retried | failed, while scraper.js also
 * emits the intermediate 'retrying' state for an attempt that failed but will
 * be retried. 'retrying' is folded into 'retried' so inserts can never violate
 * the check constraint; the raw trail is still returned to the caller.
 */
function normaliseStatus(status) {
  if (status === 'success') return 'success';
  if (status === 'retried') return 'retried';
  if (status === 'retrying') return 'retried';
  return 'failed';
}

/** Run-level status: did the scrape finish, and did it need retries? */
function runStatus(result) {
  if (!result.ok) return 'failed';
  return result.log.length > 1 ? 'retried' : 'success';
}

function errorSummary(log) {
  const failures = log.filter((entry) => entry.error);
  if (!failures.length) return null;
  return failures
    .map((entry) => `attempt ${entry.attempt}: ${entry.error}`)
    .join(' | ')
    .slice(0, 1000);
}

/**
 * Converts a scraper log trail into scrape_logs rows.
 *   LOG_GRANULARITY=run     -> 1 row per scrape run, attempts = total attempts
 *   LOG_GRANULARITY=attempt -> 1 row per attempt, attempts = attempt number
 */
function buildLogRows(productId, result) {
  const { log } = result;
  const createdAt = new Date().toISOString();

  if (config.scraping.logGranularity === 'attempt') {
    return log.map((entry) => ({
      product_id: productId,
      status: normaliseStatus(entry.status),
      attempts: entry.attempt,
      error_message: entry.error ? String(entry.error).slice(0, 1000) : null,
      created_at: entry.startedAt || createdAt,
    }));
  }

  return [
    {
      product_id: productId,
      status: runStatus(result),
      attempts: log.length,
      error_message: errorSummary(log),
      created_at: createdAt,
    },
  ];
}

// ------------------------------- search -------------------------------------

// searchCatalog() walks the whole catalog at ~300ms/page, so an uncached broad
// query ("boot") takes ~17s. A short TTL cache keeps the UI responsive when the
// user hits Search repeatedly.
const searchCache = new Map(); // cacheKey -> { expiresAt, results }

async function searchCatalog(query, { maxPages } = {}) {
  const pages = maxPages ?? config.search.maxPages;
  const key = `${query.trim().toLowerCase()}|${pages}`;
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { results: cached.results, cached: true };
  }

  const results = await scraper.searchCatalog(query, { maxPages: pages });
  searchCache.set(key, { results, expiresAt: Date.now() + config.search.cacheTtlMs });
  return { results, cached: false };
}

// ------------------------------- scraping -----------------------------------

/**
 * Scrapes one tracked product and writes price_history + scrape_logs.
 * `product` is a row from the products table (needs id + store_id).
 */
async function scrapeAndPersist(product, { maxAttempts } = {}) {
  const startedAt = Date.now();
  const result = await scraper.scrapePrice(product.store_id, { maxAttempts });
  const quote = result.quote || null;
  const status = runStatus(result);

  let priceRow = null;
  if (result.ok && quote) {
    // price_history only accepts the columns from the assignment schema.
    priceRow = await repo.createPricePoint({
      product_id: product.id,
      price: quote.shown,
      stock: quote.stock,
      scraped_at: scrapeTimestamp(quote),
    });
  }

  const logRows = await repo.createScrapeLogs(buildLogRows(product.id, result));

  return {
    productId: product.id,
    storeId: product.store_id,
    name: product.name,
    ok: result.ok,
    status,
    attempts: result.log.length,
    durationMs: Date.now() - startedAt,
    currency: (quote && quote.currency) || config.defaultCurrency,
    price: quote ? quote.shown : null,
    mrp: quote ? quote.mrp : null,
    stock: quote ? quote.stock : null,
    scrapedAt: quote ? scrapeTimestamp(quote) : null,
    lastError: errorSummary(result.log),
    attemptTrail: result.log,
    pricePoint: priceRow,
    logs: logRows,
  };
}

/**
 * Sequentially scrapes every tracked product (used by the cron endpoint).
 * Sequential on purpose: the store rate-limits (HTTP 429) and scraper.js
 * already retries per product, so hammering it in parallel would only produce
 * failures.
 */
async function runBatch({ products, delayMs = config.cron.delayMs, storeIds = null } = {}) {
  const wanted = storeIds && storeIds.length ? storeIds.map(Number) : null;
  const targets = wanted ? products.filter((p) => wanted.includes(Number(p.store_id))) : products;

  const startedAt = new Date().toISOString();
  const results = [];

  for (let i = 0; i < targets.length; i += 1) {
    const product = targets[i];
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design
      results.push(await scrapeAndPersist(product));
    } catch (err) {
      results.push({
        productId: product.id,
        storeId: product.store_id,
        name: product.name,
        ok: false,
        status: 'failed',
        attempts: 0,
        lastError: err.message,
      });
    }
    if (delayMs > 0 && i < targets.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(startedAt),
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

module.exports = {
  scrapeTimestamp,
  normaliseStatus,
  runStatus,
  errorSummary,
  buildLogRows,
  searchCatalog,
  scrapeAndPersist,
  runBatch,
  clearSearchCache: () => searchCache.clear(),
};
