# INE Product Price Tracker

A full-stack price tracker built around the pre-existing (and untouched) `scraper.js`:

* **Backend** – Node.js + Express on **port 5000**, talking to **Supabase (PostgreSQL)**.
* **Frontend** – React (Vite) + Tailwind CSS + Recharts on **port 5173**.
* **Scraping** – `scraper.js` is imported as-is; it is never modified.

> **Guardrail respected:** `scraper.js` (8,990 bytes, last written 20-09-2026 11:10) and
> `test_scraper.js` (3,553 bytes, last written 20-09-2026 10:35) are byte-for-byte untouched.
> Every file created for this assignment is newer than both, and nothing in the codebase
> writes to them.

---

## 1. Project structure

```
INE Assignment/
├── scraper.js                  # PROTECTED - core scraping logic (untouched)
├── test_scraper.js             # PROTECTED - manual scraper harness (untouched)
├── server.js                   # Express app + all API routes
├── .env / .env.example         # configuration
├── sql/schema.sql              # reference schema + RLS policies for Supabase
├── src/
│   ├── config.js               # single place that reads process.env
│   ├── db.js                   # picks Supabase or the local dev shim
│   ├── scrapeService.js        # ONLY module that calls into scraper.js
│   └── repos/
│       ├── supabaseRepo.js     # @supabase/supabase-js data access
│       └── localRepo.js        # JSON dev shim (used while Supabase creds are placeholders)
├── scripts/
│   ├── cron.js                 # CLI cron trigger (API mode or --direct mode)
│   └── smoke-test.js           # end-to-end API test (20 checks)
└── client/
    ├── vite.config.js          # dev server :5173 + /api proxy -> :5000
    ├── tailwind.config.js
    ├── scripts/ssr-smoke.mjs   # renders every page headlessly
    └── src/
        ├── api.js              # axios client + formatters
        ├── App.jsx             # routes
        ├── components/         # Layout, SearchBar, StatusBadge, LogTable
        └── pages/              # SearchPage, DashboardPage, ProductDetailPage
```

---

## 2. Setup

```bash
# 1. backend deps (root)
npm install

# 2. frontend deps
npm --prefix client install

# 3. configure
copy .env.example .env      # then edit .env (see section 3)

# 4. run both servers together
npm run dev:all
#   API      -> http://localhost:5000
#   Frontend -> http://localhost:5173
```

`npm run dev:all` uses `concurrently`. If you prefer two terminals:

```bash
npm run dev:server      # node --watch server.js
npm run dev:client      # vite (client/)
```

Production-ish single-port mode (Express serves the built SPA too):

```bash
npm run build:client    # builds client/dist
npm start               # http://localhost:5000 serves API + UI
```

---

## 3. Environment variables

| Variable | Status | Purpose |
|---|---|---|
| `PORT` | set (`5000`) | Express port |
| `SUPABASE_URL` | **NEEDS YOUR VALUE** | Supabase project URL |
| `SUPABASE_ANON_KEY` | **NEEDS YOUR VALUE** | Supabase anon/public API key |
| `INE_STORE_BASE_URL` | set | Store the scraper talks to (read by `scraper.js`) |
| `SEARCH_MAX_PAGES` | optional (`50`) | Pages `searchCatalog()` may walk |
| `SEARCH_CACHE_TTL_MS` | optional (`120000`) | In-memory search cache TTL |
| `LOG_GRANULARITY` | optional (`run`) | `run` = one log row per scrape, `attempt` = one row per attempt |
| `CRON_DELAY_MS` | optional (`250`) | Delay between products during a cron batch |
| `CRON_SECRET` | optional | If set, `POST /api/cron/scrape` requires `x-cron-secret` |
| `ENABLE_CRON_SCHEDULER` | optional (`false`) | Let the API schedule scrapes itself |
| `CRON_SCHEDULE` | optional (`*/30 * * * *`) | node-cron expression used when the scheduler is on |
| `DEFAULT_CURRENCY` | optional (`INR`) | Display currency (`price_history` has no currency column) |

### While Supabase credentials are placeholders

`SUPABASE_URL` / `SUPABASE_ANON_KEY` still contain `YOUR_...`, so `src/db.js` logs a loud
warning and uses **`src/repos/localRepo.js`**, a JSON dev shim at `.data/local-db.json` with
the same three tables and the same repository interface. That is why the endpoints could be
tested end-to-end before your credentials existed.

Once you paste the real values into `.env` and restart, `supabaseRepo.js` is used instead —
**no code changes required**. The shim file is dev-only and can be deleted at any time.

---

## 4. API

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Service + DB + cron wiring status |
| GET | `/api/search?q=boot&maxPages=50` | Calls `scraper.searchCatalog(q)`; marks already-tracked hits |
| POST | `/api/track` | Body `{ storeId, name, sku }` → inserts product, runs the first price scrape, writes `price_history` + `scrape_logs`, returns the product |
| GET | `/api/dashboard` | All tracked products + latest price/stock + last 10 scrape logs |
| POST | `/api/cron/scrape` | Re-scrapes every tracked product (optional body `{ "storeIds": [876] }`) |
| GET | `/api/products/:id` | Product detail: `price_history`, stats, last 10 scrape logs |
| DELETE | `/api/products/:id` | Stop tracking (cascades to history/logs) |

Example:

```bash
curl "http://localhost:5000/api/search?q=boot"
curl -X POST http://localhost:5000/api/track -H "Content-Type: application/json" \
     -d '{"storeId":876,"name":"Auralite Waterproof Boot XL","sku":"AUR-10876"}'
curl http://localhost:5000/api/dashboard
curl -X POST http://localhost:5000/api/cron/scrape
```

`POST /api/track` returns **409** with `alreadyTracked: true` when the store product is already
tracked, and **400** on invalid input. Add `?force=true` to re-scrape anyway. `POST
/api/cron/scrape` returns **409** if a batch is already running and **401** if `CRON_SECRET` is
set and the header is missing.

---

## 5. How scraper output maps to the database

`scraper.js` returns `{ ok, quote, log }` where `quote` is
`{ shown, mrp, stock, currency, at, ... }` and each `log` entry is
`{ attempt, startedAt, durationMs, status, error }`.

| Source | Destination |
|---|---|
| `quote.shown` | `price_history.price` |
| `quote.stock` | `price_history.stock` |
| `quote.at` (store epoch-ms) | `price_history.scraped_at` |
| `log.length` | `scrape_logs.attempts` (in `run` mode) |
| `log[].error` | `scrape_logs.error_message` |
| `log[].status` | `scrape_logs.status` |

**Status normalisation.** `scraper.js` emits four states per attempt —
`success`, `retried` (succeeded after retrying), `retrying` (attempt failed, will retry) and
`failed`. The schema you supplied only allows `success | retried | failed`, so `retrying` is
folded into `retried`, guaranteeing no check-constraint violation:

* `LOG_GRANULARITY=run` (default) – one row per scrape: `success` (first attempt worked),
  `retried` (worked after a retry), `failed` (all attempts exhausted), with
  `attempts` = number of attempts and every error concatenated into `error_message`.
* `LOG_GRANULARITY=attempt` – one row per attempt (`attempts` = the attempt number), so the
  intermediate `retrying` states are visible. The raw `attemptTrail` is always returned in the
  API response too.

A failed scrape **never** writes a `price_history` row (the scraper's own payload validation
already rejects malformed/zero/negative prices before they can reach the table); only the
failure is logged.

**Schema note:** `price_history` is written with exactly the four columns from your schema
(`product_id`, `price`, `stock`, `scraped_at`), so nothing depends on extra columns existing.
Currency is not persisted, hence `DEFAULT_CURRENCY` for display.

---

## 6. Triggering the cron job

All three options do the same work: loop over tracked products, call
`scraper.scrapePrice(storeId)`, write `price_history` + `scrape_logs`, sequentially, with
`CRON_DELAY_MS` between products (the store rate-limits aggressively — parallel calls produce
429s).

### Option A — HTTP endpoint (recommended)

```bash
curl -X POST http://localhost:5000/api/cron/scrape
curl -X POST http://localhost:5000/api/cron/scrape -H "Content-Type: application/json" -d "{\"storeIds\":[876]}"
# GET works too:  http://localhost:5000/api/cron/scrape
```

The dashboard's **"Run cron now"** button and each card's **"Scrape now"** button call this.

### Option B — CLI script

```bash
npm run cron:once                       # POSTs to the running API
node scripts/cron.js --store 876        # single product
node scripts/cron.js --url http://localhost:5000
node scripts/cron.js --direct           # in-process, no server needed
```

### Option C — in-process scheduler

```bash
# .env
ENABLE_CRON_SCHEDULER=true
CRON_SCHEDULE=*/30 * * * *
```

The API then scrapes every 30 minutes with `node-cron`; overlapping ticks are skipped.

### Wiring it to a real scheduler

*Windows Task Scheduler* – Program `node`, Arguments `scripts\cron.js --direct`,
Start in `C:\Users\shyam\OneDrive\Desktop\INE Assignment`, trigger every 30 minutes.

*Linux/macOS crontab*:

```
*/30 * * * * cd /path/to/INE\ Assignment && /usr/bin/node scripts/cron.js --direct >> .data/cron.log 2>&1
```

*GitHub Actions / Vercel Cron* – schedule a `curl -X POST https://your-host/api/cron/scrape -H "x-cron-secret: $CRON_SECRET"`.

---

## 7. Testing

```bash
npm run test:api            # 20 end-to-end API checks (needs the API running)
npm --prefix client run smoke:pages   # renders all 3 pages headlessly
npm run test:scraper -- search "boot" # the ORIGINAL harness, untouched
```

`scripts/smoke-test.js` covers health, search, track (success + duplicate + validation),
dashboard (latest price/stock/last-10 logs/status values), product detail, the cron endpoint,
the cron `storeIds` filter, history accumulation and 404 handling.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `scrape_logs` rows show `rate limited (429)` | The demo store throttles hard. Expected; retries + backoff are handled by `scraper.js`, and `CRON_DELAY_MS` (raise to 500–1000) spaces out batches. |
| First search takes 15–60 s | `searchCatalog()` pages the whole catalog with a 300 ms delay per page. Cached for `SEARCH_CACHE_TTL_MS`. |
| `/api/health` says `driver: local` | Supabase creds are still placeholders — see section 3. |
| Supabase inserts fail with a permission error | Enable RLS policies for the anon key (see `sql/schema.sql`) or use the service-role key server-side. |
| `Search` returns nothing | The scraper matches on `name` only, case-insensitively — use a short substring like `boot`. |

