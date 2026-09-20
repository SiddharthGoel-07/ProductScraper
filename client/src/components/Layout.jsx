// client/src/components/Layout.jsx
// App shell: header, nav, footer + a live API/store health pill.

import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, toApiError } from '../api';

function HealthPill() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((data) => !cancelled && setHealth(data))
      .catch((err) => !cancelled && setError(toApiError(err).message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-300">API offline</span>;
  }
  if (!health) {
    return <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-400">checking…</span>;
  }

  const isSupabase = health.database?.isSupabase;
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs ${
        isSupabase
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      }`}
      title={health.database?.reason || 'Supabase configured'}
    >
      {isSupabase ? 'Supabase connected' : 'Local dev shim (set Supabase env)'}
    </span>
  );
}

export default function Layout() {
  const link = ({ isActive }) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      isActive ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
    }`;

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500 text-lg font-bold text-white">₹</div>
            <div>
              <h1 className="text-base font-semibold text-white">INE Product Price Tracker</h1>
              <p className="text-xs text-slate-400">Express API :5000 · React :5173 · Supabase</p>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/" className={link} end>
              Search
            </NavLink>
            <NavLink to="/dashboard" className={link}>
              Dashboard
            </NavLink>
            <HealthPill />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-2 text-xs text-slate-500">
        Scraping provided by the untouched <code className="text-slate-400">scraper.js</code> module · prices stored in{' '}
        <code className="text-slate-400">price_history</code> · every attempt logged in{' '}
        <code className="text-slate-400">scrape_logs</code>
      </footer>
    </div>
  );
}
