// src/db.js
// Chooses the active data store once, at require-time, and re-exports it.
//
//   * SUPABASE_URL + SUPABASE_ANON_KEY present  -> real Supabase (production)
//   * still placeholders in .env               -> local JSON dev shim
//
// Everything downstream only talks to the repository interface, so no route
// or service needs to know which one is in play.

const config = require('./config');
const { createSupabaseRepo } = require('./repos/supabaseRepo');
const { createLocalRepo } = require('./repos/localRepo');

const repo = config.supabase.configured
  ? createSupabaseRepo({ url: config.supabase.url, anonKey: config.supabase.anonKey })
  : createLocalRepo();

if (repo.kind === 'local') {
  // Deliberately loud: this log line is the signal that data is NOT going to
  // Supabase yet.
  console.warn(
    '[db] ================================================================\n' +
      `[db] Supabase is NOT configured (${config.supabase.reason}).\n` +
      `[db] Using the LOCAL JSON dev shim: ${repo.file}\n` +
      '[db] Fill SUPABASE_URL + SUPABASE_ANON_KEY in .env and restart to use\n' +
      '[db] the real database. No code changes are needed.\n' +
      '[db] ================================================================'
  );
} else {
  console.log(`[db] Supabase repository active (${config.supabase.url}).`);
}

module.exports = { repo, isSupabase: repo.kind === 'supabase' };
