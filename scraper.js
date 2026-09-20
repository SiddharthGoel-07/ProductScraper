// scraper.js
// Core scraping logic for the INE mock store. Talks to the real HTTP API
// directly (no headless browser) using the reverse-engineered challenge
// protocol. Exposes:
//   - searchCatalog(query)      : find products by partial/full name
//   - getProduct(id)            : product detail (specs, reviews)
//   - scrapePrice(id, opts)     : price/stock, with retries + a structured log

const crypto = require('crypto');

const BASE_URL = process.env.INE_STORE_BASE_URL || 'https://demo.inelabteamdev.com';
const SECRET = 'ine-mock-store-shared-k3y';

// ---------- low-level crypto/protocol helpers (reverse-engineered) ----------

function sha256hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}
function sha256bytes(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest();
}
function solvePow(salt, difficulty) {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (!sha256hex(`${salt}:${nonce}`).startsWith(target)) nonce++;
  return nonce;
}
function deriveSeed(salt, attestationHash) {
  return parseInt(sha256hex(`${SECRET}|seed|${salt}|${attestationHash}`).slice(0, 8), 16) | 0;
}
function deriveDerived(salt, wasmOut, attestationHash) {
  return sha256hex(`${SECRET}|derive|${salt}|${wasmOut | 0}|${attestationHash}`);
}
async function runWasm(wasmB64, seed) {
  const bytes = Buffer.from(wasmB64, 'base64');
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module);
  return instance.exports.f(seed) | 0;
}
function decryptPrice(encryptedB64, token) {
  const key = sha256bytes(`${SECRET}|enc|${token}`);
  const data = Buffer.from(encryptedB64, 'base64');
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  const obj = JSON.parse(out.toString('utf8'));
  return {
    shown: obj.p,
    mrp: obj.m,
    sale: obj.n,
    badgePct: obj.b,
    stock: obj.s,
    currency: obj.c,
    at: obj.t,
    rating: obj.r,
    ratingCount: obj.rc,
    seller: obj.sl,
    deliveryDays: obj.dd,
    variant: obj.v,
    pending: obj.g === 1,
    format: obj.f,
    triple: obj.x === 1,
  };
}
function buildFakeAttestation() {
  const now = Date.now();
  const moves = [];
  let t = now - 5000;
  for (let i = 0; i < 10; i++) {
    t += 80 + Math.floor(Math.random() * 40);
    moves.push([300 + i * 20, 400 - i * 5, t]);
  }
  const ix = { hoverAt: now - 4500, dwellMs: 4500, moves, clickAt: now, trusted: true };
  const env = {
    canvas: crypto.randomBytes(8).toString('hex'),
    gl: crypto.randomBytes(8).toString('hex'),
    hc: 8,
    scr: [1920, 1080, 1],
    frames: [16.6, 16.7, 16.5, 16.8, 16.6, 16.7, 16.6, 16.9],
    at: now,
  };
  return JSON.stringify({ env, ix });
}

// fetch with a hard timeout, since the assignment explicitly says responses
// are sometimes just slow (not erroring) and the scraper must not hang.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- public: catalog / product detail (unprotected endpoints) ----------
// ---------- public: catalog / product detail (unprotected endpoints) ----------

async function searchCatalog(query, { maxPages = 50, pageSize = 20 } = {}) {
  const q = query.trim().toLowerCase();
  const matches = [];
  
  for (let page = 1; page <= maxPages; page++) {
    const maxRetries = 4;
    
    // Retry loop for each individual page
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchWithTimeout(`${BASE_URL}/api/catalog?page=${page}&pageSize=${pageSize}`);
        
        // Treat rate limits and server errors as retryable exceptions
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (!res.ok) {
          throw new Error(`catalog page ${page} failed: ${res.status}`);
        }
        
        const body = await res.json();
        for (const item of body.items) {
          if (item.name.toLowerCase().includes(q)) {
            // Prevent duplicates by checking if the item ID is already in the matches array
            if (!matches.some((m) => m.id === item.id)) {
              matches.push(item);
            }
          }
        }
        
        // If we reached the actual last page, signal the outer loop to stop
        if (page >= body.pages) {
          maxPages = 0; 
        }
        
        // BASELINE DELAY: Wait 300ms before requesting the next page to avoid 429s
        await new Promise((resolve) => setTimeout(resolve, 300));
        
        break; // Success! Break out of the retry loop and move to the next page
        
      } catch (err) {
        console.warn(`[Warning] Catalog page ${page} failed (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying...`);
        
        if (attempt === maxRetries) {
          throw new Error(`Catalog page ${page} fatally failed after ${maxRetries} attempts.`);
        }
        
        // BACKOFF DELAY: Wait 1s, then 2s, then 4s before trying this page again
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  return matches;
}
async function getProduct(productId) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/product/${productId}`);
  if (!res.ok) throw new Error(`product ${productId} fetch failed: ${res.status}`);
  return res.json();
}

// ---------- public: price scraping (protected endpoint, one attempt) ----------

async function scrapePriceOnce(productId) {
  const challengeRes = await fetchWithTimeout(`${BASE_URL}/api/challenge`);
  if (!challengeRes.ok) throw new Error(`challenge fetch failed: ${challengeRes.status}`);
  const challenge = await challengeRes.json();

  const att = buildFakeAttestation();
  const attHash = sha256hex(att);
  const wasmOut = await runWasm(challenge.wasm, deriveSeed(challenge.salt, attHash));
  const nonce = solvePow(challenge.salt, challenge.difficulty);
  const derived = deriveDerived(challenge.salt, wasmOut, attHash);

  const sessionRes = await fetchWithTimeout(`${BASE_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...challenge, nonce, derived, wasmOut, att, productId }),
  });
  if (sessionRes.status === 429) throw new Error('rate limited (429)');
  if (!sessionRes.ok) throw new Error(`session failed: ${sessionRes.status}`);
  const { token } = await sessionRes.json();

  const priceRes = await fetchWithTimeout(`${BASE_URL}/api/products/${productId}/price`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (priceRes.status === 401 || priceRes.status === 403) throw new Error('unauthorized');
  if (!priceRes.ok) throw new Error(`price fetch failed: ${priceRes.status}`);
  const body = await priceRes.json();

  const quote = decryptPrice(body.e, token);

  // Sanity-check the decrypted payload before trusting it -- never let
  // malformed/zero/negative data flow into price_history.
  if (
    typeof quote.shown !== 'number' || !isFinite(quote.shown) || quote.shown <= 0 ||
    typeof quote.stock !== 'number' || !isFinite(quote.stock) || quote.stock < 0
  ) {
    throw new Error(`decrypted payload failed validation: ${JSON.stringify(quote)}`);
  }

  return quote;
}

// Wraps scrapePriceOnce with retries + exponential backoff + a structured
// log the caller can persist as-is into a scrape_log table.
async function scrapePrice(productId, { maxAttempts = 4, baseDelayMs = 500 } = {}) {
  const log = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const quote = await scrapePriceOnce(productId);
      log.push({
        attempt,
        startedAt,
        durationMs: Date.now() - t0,
        status: attempt === 1 ? 'success' : 'retried',
        error: null,
      });
      return { ok: true, quote, log };
    } catch (err) {
      log.push({
        attempt,
        startedAt,
        durationMs: Date.now() - t0,
        status: attempt < maxAttempts ? 'retrying' : 'failed',
        error: err.message,
      });
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return { ok: false, quote: null, log };
}

module.exports = { searchCatalog, getProduct, scrapePrice, scrapePriceOnce, BASE_URL };