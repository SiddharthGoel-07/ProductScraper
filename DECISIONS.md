# Design Note

## Reliability

- **Retries**: up to 4 attempts per scrape, exponential backoff + jitter.
- **Timeouts**: 8s hard timeout per request (`AbortController`) — a hang is treated as
  retryable, not left to stall.
- **Validation before saving**: price must be finite and > 0, stock finite and ≥ 0. Anything
  else is logged as a failure and never written to `price_history`.
- **Honest logging**: every attempt logs timestamp, duration, status, and error. Failures are
  recorded, never hidden.
- **Sequential cron, not parallel**: the store rate-limits hard (`429`) on concurrent
  requests, so products are scraped one at a time with a small delay between them.
- **Short-lived tokens (30s)**: the challenge → session → price sequence has to complete
  quickly — timeouts and retries are what protect that window.

## NO Headless Browser

The store looks like it needs one: client-rendered SPA, price data gated behind a WASM
proof-of-work, a browser "attestation" (mouse movement, canvas/GL fingerprint), and an
encrypted response.

Reverse-engineering the JS bundle showed otherwise:
- The WASM challenge is a pure, stateless function — runs fine in Node's built-in
  `WebAssembly`, no browser needed.
- The server only checks **self-consistency**: does the submitted hash match the attestation
  string the client sent? It never verifies the attestation reflects real mouse/hardware
  activity — so a fabricated one passes.
- The price payload decrypts with a key derived from the session token via a plain hash, no
  browser crypto involved.

This was confirmed *before* writing the scraper: the reimplementation correctly decrypted an
already-captured real price response, and independently found the exact same PoW nonce the
real browser had used for that challenge.

**Decision**: `scraper.js` talks to the store's API directly — no browser dependency.

**Trade-off**: more brittle if the store's JS logic changes (needs re-analysis vs. just
working). Worth it here for the performance/simplicity win, and it's the approach the
assignment itself rewards when it's actually justified.

## Other trade-offs

- `scraper.js` / `test_scraper.js` are untouched — all backend logic wraps them in
  `scrapeService.js`, keeping the reverse-engineered protocol isolated and testable.
- `LOG_GRANULARITY` is configurable: `run` (compact, one row per scrape) or `attempt` (full
  retry-by-retry audit trail).
- A local JSON repo shim mirrors the Supabase repo interface, so the whole stack could be
  tested end-to-end before real credentials existed — no code changes needed once they were
  added.

## What the AI got wrong first

The first instinct was Playwright — the WASM/attestation/encryption gate *looked* like it
needed a real browser. That was wrong: the HAR showed a clean JSON API underneath, and the
deobfuscated bundle showed the "hard" parts were self-consistent computations, not real
checks. Verifying the full protocol against a real captured response — before writing any
scraper code — avoided an unnecessary Playwright dependency and produced a lighter, faster
scraper instead.