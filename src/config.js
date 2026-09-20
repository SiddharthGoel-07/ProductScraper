// src/config.js
// Single place where environment configuration is read, validated and
// normalised. Nothing else in the backend reads process.env directly.

require('dotenv').config();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A Supabase credential is considered "usable" only when it is not one of the
 * placeholders shipped in .env. This lets the app run (against a local shim)
 * before the real project URL/anon key are pasted in.
 */
function looksConfigured(value, placeholderHints) {
  if (!value) return false;
  const v = String(value).trim();
  if (!v) return false;
  const upper = v.toUpperCase();
  if (placeholderHints.some((hint) => upper.includes(hint))) return false;
  return true;
}

const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

const supabaseUrlOk = looksConfigured(supabaseUrl, ['YOUR_', 'REPLACE', 'CHANGEME']);
const supabaseKeyOk = looksConfigured(supabaseAnonKey, ['YOUR_', 'REPLACE', 'CHANGEME']);

const config = {
  port: int(process.env.PORT, 5000),

  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    configured: Boolean(supabaseUrlOk && supabaseKeyOk),
    // Explains *why* we are not talking to Supabase, surfaced by /api/health.
    reason: supabaseUrlOk && supabaseKeyOk
      ? null
      : !supabaseUrlOk
        ? 'SUPABASE_URL is missing or still a placeholder'
        : 'SUPABASE_ANON_KEY is missing or still a placeholder',
  },

  store: {
    // scraper.js reads INE_STORE_BASE_URL itself at require-time.
    baseUrl: process.env.INE_STORE_BASE_URL || 'https://demo.inelabteamdev.com',
  },

  search: {
    maxPages: int(process.env.SEARCH_MAX_PAGES, 50),
    cacheTtlMs: int(process.env.SEARCH_CACHE_TTL_MS, 120000),
  },

  scraping: {
    // 'run'     -> one scrape_logs row per scrape run (attempts = total attempts)
    // 'attempt' -> one scrape_logs row per individual attempt
    logGranularity: (process.env.LOG_GRANULARITY || 'run').trim().toLowerCase() === 'attempt'
      ? 'attempt'
      : 'run',
  },

  cron: {
    delayMs: int(process.env.CRON_DELAY_MS, 250),
    secret: (process.env.CRON_SECRET || '').trim() || null,
    enableScheduler: bool(process.env.ENABLE_CRON_SCHEDULER, false),
    schedule: (process.env.CRON_SCHEDULE || '*/30 * * * *').trim(),
  },

  defaultCurrency: (process.env.DEFAULT_CURRENCY || 'INR').trim().toUpperCase(),
};

module.exports = config;
