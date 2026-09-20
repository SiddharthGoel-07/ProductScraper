// src/repos/supabaseRepo.js
// Thin data-access layer over @supabase/supabase-js.
//
// The repository only ever touches the three tables from the assignment
// schema and only the columns that schema defines, so inserts can never fail
// because of a column that does not exist:
//   products      : id, store_id, name, sku
//   price_history : id, product_id, price, stock, scraped_at
//   scrape_logs   : id, product_id, status, attempts, error_message, created_at
//
// Supabase's JS client cannot express "latest row per product" joins, so
// latest-price / last-N-logs lookups are done with keyset-style paging:
// fetch ordered desc, page through until every requested product is covered.

const { createClient } = require('@supabase/supabase-js');

const PAGE_SIZE = 1000; // Supabase caps a single response at 1000 rows
const MAX_PAGES = 20;   // hard stop so a huge table can never hang a request

function createSupabaseRepo({ url, anonKey }) {
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  function unwrap({ data, error }) {
    if (error) {
      const err = new Error(`Supabase error: ${error.message}`);
      err.status = 502;
      err.cause = error;
      throw err;
    }
    return data;
  }

  return {
    kind: 'supabase',
    client: supabase,

    /** Cheap round-trip used by /api/health to prove the credentials work. */
    async ping() {
      const { error } = await supabase.from('products').select('id').limit(1);
      if (error) throw new Error(error.message);
      return true;
    },

    // ----------------------------- products -----------------------------
    async listProducts() {
      const rows = unwrap(
        await supabase
          .from('products')
          .select('id, store_id, name, sku')
          .order('name', { ascending: true })
      );
      return rows || [];
    },

    async getProductById(id) {
      const rows = unwrap(await supabase.from('products').select('*').eq('id', id).limit(1));
      return (rows && rows[0]) || null;
    },

    async getProductByStoreId(storeId) {
      const rows = unwrap(
        await supabase.from('products').select('*').eq('store_id', Number(storeId)).limit(1)
      );
      return (rows && rows[0]) || null;
    },

    async createProduct({ store_id, name, sku }) {
      const rows = unwrap(
        await supabase
          .from('products')
          .insert([{ store_id: Number(store_id), name: name ?? null, sku: sku ?? null }])
          .select()
      );
      return rows && rows[0];
    },

    async deleteProduct(id) {
      unwrap(await supabase.from('products').delete().eq('id', id).select('id'));
      return true;
    },

    // ----------------------------- price_history ------------------------
    async createPricePoint({ product_id, price, stock, scraped_at }) {
      const rows = unwrap(
        await supabase
          .from('price_history')
          .insert([{ product_id, price, stock, scraped_at }])
          .select()
      );
      return rows && rows[0];
    },

    /**
     * Price history for one product. Always fetches the NEWEST `limit` rows and
     * returns them ascending when asked (ordering ascending+limit in Postgres
     * would return the oldest rows instead).
     */
    async listPriceHistory(productId, { limit = 200, ascending = true } = {}) {
      const rows = unwrap(
        await supabase
          .from('price_history')
          .select('id, product_id, price, stock, scraped_at')
          .eq('product_id', productId)
          .order('scraped_at', { ascending: false })
          .limit(limit)
      );
      const newestFirst = rows || [];
      return ascending ? newestFirst.slice().reverse() : newestFirst;
    },

    /**
     * Latest price row for each requested product (used by the dashboard).
     * Paged so one very chatty product cannot starve the others.
     */
    async listLatestPrices(productIds) {
      const wanted = new Set((productIds || []).map(String));
      const latest = {};
      if (!wanted.size) return latest;

      for (let page = 0; page < MAX_PAGES && wanted.size; page += 1) {
        const from = page * PAGE_SIZE;
        const rows = unwrap(
          await supabase
            .from('price_history')
            .select('id, product_id, price, stock, scraped_at')
            .in('product_id', [...wanted])
            .order('scraped_at', { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
        );
        if (!rows || !rows.length) break;
        for (const row of rows) {
          if (wanted.has(String(row.product_id))) {
            latest[row.product_id] = row; // first hit wins (desc order)
            wanted.delete(String(row.product_id));
          }
        }
        if (rows.length < PAGE_SIZE) break;
      }
      return latest;
    },

    // ----------------------------- scrape_logs --------------------------
    async createScrapeLogs(entries) {
      if (!entries || !entries.length) return [];
      const rows = unwrap(await supabase.from('scrape_logs').insert(entries).select());
      return rows || [];
    },

    async listScrapeLogs(productId, { limit = 10 } = {}) {
      const rows = unwrap(
        await supabase
          .from('scrape_logs')
          .select('id, product_id, status, attempts, error_message, created_at')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(limit)
      );
      return rows || [];
    },

    /** Last `perProduct` logs for every requested product (dashboard view). */
    async listScrapeLogsForProducts(productIds, { perProduct = 10 } = {}) {
      const wanted = [...new Set((productIds || []).map(String))];
      const grouped = {};
      if (!wanted.length) return grouped;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * PAGE_SIZE;
        const rows = unwrap(
          await supabase
            .from('scrape_logs')
            .select('id, product_id, status, attempts, error_message, created_at')
            .in('product_id', wanted)
            .order('created_at', { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
        );
        if (!rows || !rows.length) break;
        for (const row of rows) {
          const key = String(row.product_id);
          if (!grouped[key]) grouped[key] = [];
          if (grouped[key].length < perProduct) grouped[key].push(row);
        }
        if (wanted.every((id) => (grouped[id] || []).length >= perProduct)) break;
        if (rows.length < PAGE_SIZE) break;
      }
      return grouped;
    },

    /** Latest log row per product (dashboard "last status" badge). */
    async listLatestScrapeLogs(productIds) {
      const grouped = await this.listScrapeLogsForProducts(productIds, { perProduct: 1 });
      const latest = {};
      for (const [productId, rows] of Object.entries(grouped)) latest[productId] = rows[0];
      return latest;
    },
  };
}

module.exports = { createSupabaseRepo };
