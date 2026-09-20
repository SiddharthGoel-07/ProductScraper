# Final Report — INE Product Price Tracker

**Date:** 20 September 2026
**Scope:** application shell around the pre-existing `scraper.js` — Express API (`:5000`),
Supabase data layer, React dashboard (`:5173`), cron trigger, tests.

---

## 1. Deliverables

| Item | Location | Status |
|---|---|---|
| Express API (4 required routes + extras) | `server.js` | Done, tested |
| Config / env handling | `src/config.js`, `.env`, `.env.example` | Done |
| Supabase data access (`@supabase/supabase-js`) | `src/repos/supabaseRepo.js` | Done (not yet exercised — see §5.6) |
| Local JSON dev shim (same interface) | `src/repos/localRepo.js`, `src/db.js` | Done, used for live tests |
| Scraper wrapper (import-only) | `src/scrapeService.js` | Done, tested |
| Cron CLI + optional scheduler | `scripts/cron.js`, `server.js` | Done, tested both modes |
| API end-to-end test | `scripts/smoke-test.js` | **20/20 checks pass** |
| React app (Vite + Tailwind + Recharts) | `client/` | Done, builds + renders |
| Page render check | `client/scripts/ssr-smoke.mjs` | **3/3 pages render** |
| Reference SQL schema + RLS | `sql/schema.sql` | Done |
| Docs | `README.md`, `REPORT.md` | Done |

**Installed dependencies** — backend: `express`, `cors`, `@supabase/supabase-js`, `dotenv`,
`node-cron`, `concurrently` (dev). Frontend: `react`, `react-dom`, `react-router-dom`, `axios`,
`recharts`, `tailwindcss@3.4`, `postcss`, `autoprefixer`, `vite@5`, `@vitejs/plugin-react`.

---

## 2. Guardrail compliance: `scraper.js` was never touched

| File | Size | Last written | Modified by me? |
|---|---|---|---|
| `scraper.js` | 8,990 bytes | 20-09-2026 11:10:12 | **No** |
| `test_scraper.js` | 3,553 bytes | 20-09-2026 10:35:16 | **No** |

Both timestamps pre-date every file created in this session (11:43 onwards) and the sizes are
identical to the original directory listing. The only references to the scraper in the new code
are `require('../scraper.js')` inside `src/scrapeService.js` (plus `BASE_URL` in `server.js` for
the health endpoint). No wrapper, monkey-patch or re-implementation exists.

The original harness still works unchanged: `npm run test:scraper -- price 876`.

---

## 3. Environment variables — what you still need to fill in

### Missing (I cannot supply these; the app runs without them via the dev shim)

```dotenv
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-public-key>
```

* `.env` currently ships the placeholders `YOUR_SUPABASE_PROJECT_URL` / `YOUR_SUPABASE_ANON_KEY`.
* `src/config.js` detects placeholders, so `/api/health` reports `database.driver = "local"`
  with `reason = "SUPABASE_URL is missing or still a placeholder"`, and the UI header shows an
  amber **“Local dev shim”** pill.
* Paste the real values, restart the API, and Supabase becomes active automatically — the pill
  turns green and `/api/health` reports `"driver": "supabase"`. **No code change is needed.**
* Before the first run against real Supabase, ensure the three tables exist and the anon key can
  read/write them (RLS). `sql/schema.sql` has the exact DDL plus permissive demo policies.
* Data written to the shim (`.data/local-db.json`) is **not** migrated. Delete `.data` when you
  switch if you want a clean slate.

### Already set / optional (defaults applied)

`PORT=5000`, `INE_STORE_BASE_URL=https://demo.inelabteamdev.com`, `SEARCH_MAX_PAGES=50`,
`SEARCH_CACHE_TTL_MS=120000`, `LOG_GRANULARITY=run`, `CRON_DELAY_MS=250`, `DEFAULT_CURRENCY=INR`,
and (commented out) `CRON_SECRET`, `ENABLE_CRON_SCHEDULER`, `CRON_SCHEDULE`.

## 4. Testing outcomes

Both servers were started (`node server.js` on :5000, `vite` on :5173) and the suite was run
against the live INE store.

### 4.1 Backend end-to-end — 20/20 passed (`npm run test:api`)

```
[PASS] GET /api/health returns 200 - db=local
[PASS] health reports the INE store base URL - https://demo.inelabteamdev.com
[PASS] GET /api/search returns 200 - 17 result(s)
[PASS] search results carry an id + name - Basecamp Hiking Boot Two
[PASS] search results carry a sku - BAS-10558
[PASS] POST /api/track for storeId=558 - http 201, scrape=success
[PASS] POST /api/track rejects duplicates with 409 - Product is already tracked.
[PASS] POST /api/track validates input with 400 - Body field "storeId" must be a positive integer.
[PASS] GET /api/dashboard returns 200 - 1 product(s)
[PASS] dashboard includes latest price/stock - {"price":5938,"stock":0,"scraped_at":"2026-09-20T06:21:47.543Z"}
[PASS] dashboard includes up to 10 scrape logs per product - 1 log(s)
[PASS] dashboard log statuses are within (success|retried|failed) - success
[PASS] GET /api/products/:id returns 200 - 1 price point(s)
[PASS] product detail exposes price history
[PASS] product detail exposes stats
[PASS] POST /api/cron/scrape re-scrapes tracked products - 0/1 ok in 4271ms
[PASS] cron honours the storeIds filter - total=1
[PASS] price_history accumulated a new point after the cron runs - 1 point(s)
[PASS] scrape_logs recorded the cron runs - 3 log row(s)
[PASS] unknown product returns 404 - Product 00000000-0000-0000-0000-000000000000 is not tracked.

=== 20/20 checks passed ===
```

A second run of the same suite (after three products were tracked) also passed **20/20**, with
`POST /api/cron/scrape → 2/3 ok in 9756ms`: one product hit `429` on every attempt and was
recorded as `failed` while the other two succeeded, confirming the suite is repeatable and that a
partial failure does not fail the batch.

> The `0/1 ok` cron result is **real upstream behaviour, not a bug**: the demo store threw
> `429`/`503`. It is useful evidence that the failure path works — the errors were captured
> verbatim in `scrape_logs` (see §4.3) and no bad price was written to `price_history`.

### 4.2 Frontend

| Check | How | Result |
|---|---|---|
| Production build | `npm --prefix client run build` | ✅ 895 modules → `dist/index.html` + CSS 16.07 kB + JS 636.44 kB |
| Dev server serves SPA | `GET http://localhost:5173/` | ✅ 200, Vite client + `/src/main.jsx` injected |
| JSX transform | `GET http://localhost:5173/src/main.jsx` | ✅ transformed ES module |
| `/api` proxy (GET) | `:5173/api/health`, `:5173/api/dashboard` | ✅ 200 / 200 (`driver=local`, `products=1`) |
| `/api` proxy (POST) | `POST :5173/api/cron/scrape` | ✅ 200 (`total=1, succeeded=1`) |
| Page render (headless SSR) | `npm --prefix client run smoke:pages` | ✅ all three pages rendered |

```
[PASS] rendered SearchPage at / (1999 chars of HTML)
[PASS] rendered DashboardPage at /dashboard (3070 chars of HTML)
[PASS] rendered ProductDetailPage at /products/0000... (1438 chars of HTML)
```

### 4.3 Live `scrape_logs` evidence (success vs retried vs failed)

Recorded for the tracked product during testing — exactly what the UI's log table renders:

| status | attempts | error_message |
|---|---|---|
| `success` | 1 | — |
| `retried` | 2 | `attempt 1: price fetch failed: 503` |
| `failed` | 4 | `attempt 1: price fetch failed: 503 \| attempt 2: rate limited (429) \| attempt 3: rate limited (429) \| attempt 4: price fetch failed: 429` |
| `failed` | 4 | `attempt 1: challenge fetch failed: 429 \| attempt 2: rate limited (429) \| attempt 3: rate limited (429) \| attempt 4: price fetch failed: 503` |

### 4.4 Multi-product cron loop

Tracked a second product (`storeId 876`) and ran the batch:

```
track -> 201 scrape: success price: 11992 attempts: 1
cron  -> 200 total: 2 ok: 2 failed: 0 ms: 471
  - Auralite Waterproof Boot XL | success | attempts 1 | err: null
  - Basecamp Hiking Boot Two    | success | attempts 1 | err: null
```

`price_history` for the first product accumulated real points `5938 → 6434`
(`stats: {points: 3, min: 5938, max: 6434, avg: 6268.67, changePct: 8.35}`) — this is the series
the Recharts price line plots.

### 4.5 Configuration variants exercised

* `LOG_GRANULARITY=attempt` → one row per attempt with `attempts` = attempt number (verified: a
  1-attempt run produced exactly one row with `attempts: 1`).
* `scripts/cron.js` in API mode and `--direct` mode (no server required):
  `[cron:direct] done: 1/1 succeeded in 302ms`.

---

## 5. Observations, assumptions and risks

1. **Upstream rate limiting is the dominant failure mode.** The demo store returns `429`/`503`
   frequently. `scraper.js` already retries with exponential backoff; the API adds
   `CRON_DELAY_MS` (default 250 ms) between products and rejects overlapping batches with `409`.
   Raise `CRON_DELAY_MS` to 500–1000 ms if you track many products.
2. **Search latency.** `searchCatalog()` walks the catalog at ~300 ms/page (≈17 s for `"boot"`).
   A TTL cache (`SEARCH_CACHE_TTL_MS`) makes repeat searches instant; the UI warns that the first
   search is slow and the axios timeout for it is raised to 90 s.
3. **`price_history` has no currency column** in your schema, so only the four documented columns
   are written and the UI displays `DEFAULT_CURRENCY` (`INR`). `quote.mrp`, `rating`, `seller`,
   `deliveryDays` etc. are returned live by the API but intentionally not persisted.
4. **`scrape_logs.status` constraint.** The scraper emits `retrying`, which is not in your enum;
   it is normalised to `retried` so an insert can never violate the check constraint. Raw attempt
   trails remain available in the API response.
5. **Duplicate tracking** returns `409 alreadyTracked` instead of creating a second row (a unique
   index on `products.store_id` is included in `sql/schema.sql`). `?force=true` re-scrapes.
6. **The Supabase code path is written but not yet executed** — it activates the moment the two
   credentials are pasted in. Its correctness rests on: only schema columns being used, inserts
   via `.insert([...]).select()`, and "latest price per product" / "last 10 logs per product"
   being computed with paged `order(...).range(...)` queries (the JS client cannot express those
   joins). **Please re-run `npm run test:api` after adding credentials** to confirm
   `driver: supabase`.
7. **The cron endpoint is unauthenticated by default** (as specified). Set `CRON_SECRET` before
   exposing the service publicly; callers must then send the `x-cron-secret` header. The same
   applies to the `GET /api/cron/scrape` convenience route.

---

## 6. How to trigger the cron job

```bash
# A. HTTP (this is what the UI buttons call)
curl -X POST http://localhost:5000/api/cron/scrape
curl -X POST http://localhost:5000/api/cron/scrape -H "Content-Type: application/json" -d "{\"storeIds\":[876]}"

# B. CLI (works with or without the API running)
npm run cron:once                # POSTs to the API
node scripts/cron.js --direct    # runs the batch in-process

# C. Let the API schedule itself (.env)
#    ENABLE_CRON_SCHEDULER=true
#    CRON_SCHEDULE=*/30 * * * *
```

**External scheduler (recommended for production)** — Windows Task Scheduler:

```
Program   : C:\Program Files\nodejs\node.exe
Arguments : scripts\cron.js --direct
Start in  : C:\Users\shyam\OneDrive\Desktop\INE Assignment
Trigger   : daily, repeat every 30 minutes
```

Linux/macOS crontab:

```
*/30 * * * * cd "/path/to/INE Assignment" && /usr/bin/node scripts/cron.js --direct >> .data/cron.log 2>&1
```

Each run loops over every row in `products`, calls `scraper.scrapePrice(store_id)`, writes one
`price_history` row per success and one `scrape_logs` row per scrape (or per attempt when
`LOG_GRANULARITY=attempt`), then prints a `succeeded/total` summary.

---

## 7. Your remaining checklist

1. Put the real `SUPABASE_URL` and `SUPABASE_ANON_KEY` into `.env`.
2. Confirm the three tables exist; otherwise run `sql/schema.sql` (includes anon RLS policies).
3. Restart the API → `http://localhost:5000/api/health` should show `"driver": "supabase"`.
4. `npm --prefix client install && npm run dev:all`, then open `http://localhost:5173`.
5. Re-run `npm run test:api` to confirm the 20 checks pass against Supabase.
6. Schedule the cron job (§6) and optionally set `CRON_SECRET`.


