// src/repos/localRepo.js
// LOCAL DEV SHIM - not a replacement for Supabase.
//
// While SUPABASE_URL / SUPABASE_ANON_KEY are still placeholders in .env this
// repository keeps the exact same three "tables" in a JSON file
// (.data/local-db.json) so the API, the React UI and /api/track can be
// exercised end-to-end before real credentials exist. It implements the same
// method surface as supabaseRepo, so switching over is a pure config change.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY_DB = { products: [], price_history: [], scrape_logs: [] };

function createLocalRepo({ file = path.join(__dirname, '..', '..', '.data', 'local-db.json') } = {}) {
  let db = null;

  function load() {
    if (db) return db;
    try {
      db = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const table of Object.keys(EMPTY_DB)) {
        if (!Array.isArray(db[table])) db[table] = [];
      }
    } catch {
      db = JSON.parse(JSON.stringify(EMPTY_DB));
    }
    return db;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2));
  }

  const iso = (value) => (value ? new Date(value).toISOString() : new Date().toISOString());

  // Helpers mirroring the parts of the Postgres semantics we rely on.
  const byOrder = (a, b, asc) => {
    const diff = new Date(a).getTime() - new Date(b).getTime();
    return asc ? diff : -diff;
  };

  return {
    kind: 'local',
    file,

    async ping() {
      load();
      return true;
    },

    // ----------------------------- products -----------------------------
    async listProducts() {
      return load()
        .products.slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    },

    async getProductById(id) {
      return load().products.find((p) => String(p.id) === String(id)) || null;
    },

    async getProductByStoreId(storeId) {
      return load().products.find((p) => Number(p.store_id) === Number(storeId)) || null;
    },

    async createProduct({ store_id, name, sku }) {
      const products = load().products;
      const row = {
        id: crypto.randomUUID(),
        store_id: Number(store_id),
        name: name ?? null,
        sku: sku ?? null,
      };
      products.push(row);
      persist();
      return row;
    },

    async deleteProduct(id) {
      const data = load();
      data.products = data.products.filter((p) => String(p.id) !== String(id));
      data.price_history = data.price_history.filter((r) => String(r.product_id) !== String(id));
      data.scrape_logs = data.scrape_logs.filter((r) => String(r.product_id) !== String(id));
      persist();
      return true;
    },

    // --------------------------- price_history --------------------------
    async createPricePoint({ product_id, price, stock, scraped_at }) {
      const row = {
        id: crypto.randomUUID(),
        product_id,
        price: price === undefined || price === null ? null : Number(price),
        stock: stock === undefined || stock === null ? null : Number(stock),
        scraped_at: iso(scraped_at),
      };
      load().price_history.push(row);
      persist();
      return row;
    },

    async listPriceHistory(productId, { limit = 200, ascending = true } = {}) {
      const rows = load()
        .price_history.filter((r) => String(r.product_id) === String(productId))
        .sort((a, b) => byOrder(a.scraped_at, b.scraped_at, ascending));
      return ascending ? rows.slice(-limit) : rows.slice(0, limit);
    },

    async listLatestPrices(productIds) {
      const wanted = new Set((productIds || []).map(String));
      const latest = {};
      const rows = load()
        .price_history.filter((r) => wanted.has(String(r.product_id)))
        .sort((a, b) => byOrder(a.scraped_at, b.scraped_at, false));
      for (const row of rows) {
        const key = String(row.product_id);
        if (!latest[key]) latest[key] = row;
      }
      return latest;
    },

    // ----------------------------- scrape_logs --------------------------
    async createScrapeLogs(entries) {
      if (!entries || !entries.length) return [];
      const data = load();
      const rows = entries.map((entry) => ({
        id: crypto.randomUUID(),
        product_id: entry.product_id,
        status: entry.status,
        attempts: entry.attempts ?? null,
        error_message: entry.error_message ?? null,
        created_at: iso(entry.created_at),
      }));
      data.scrape_logs.push(...rows);
      persist();
      return rows;
    },

    async listScrapeLogs(productId, { limit = 10 } = {}) {
      return load()
        .scrape_logs.filter((r) => String(r.product_id) === String(productId))
        .sort((a, b) => byOrder(a.created_at, b.created_at, false))
        .slice(0, limit);
    },

    async listScrapeLogsForProducts(productIds, { perProduct = 10 } = {}) {
      const wanted = new Set((productIds || []).map(String));
      const grouped = {};
      const rows = load()
        .scrape_logs.filter((r) => wanted.has(String(r.product_id)))
        .sort((a, b) => byOrder(a.created_at, b.created_at, false));
      for (const row of rows) {
        const key = String(row.product_id);
        if (!grouped[key]) grouped[key] = [];
        if (grouped[key].length < perProduct) grouped[key].push(row);
      }
      return grouped;
    },

    async listLatestScrapeLogs(productIds) {
      const grouped = await this.listScrapeLogsForProducts(productIds, { perProduct: 1 });
      const latest = {};
      for (const [productId, rows] of Object.entries(grouped)) latest[productId] = rows[0];
      return latest;
    },
  };
}

module.exports = { createLocalRepo };
