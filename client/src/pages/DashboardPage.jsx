// client/src/pages/DashboardPage.jsx
// GET /api/dashboard -> every tracked product with its latest price, stock and
// the last 10 scrape logs. Also exposes the manual cron trigger.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LogTable from '../components/LogTable';
import StatusBadge from '../components/StatusBadge';
import { api, formatDateTime, formatMoney, formatRelative, toApiError } from '../api';

const AUTO_REFRESH_MS = 30000;

function StatCard({ label, value, hint }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Notice({ notice }) {
  if (!notice) return null;
  const tone =
    notice.type === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : notice.type === 'warn'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return <p className={`rounded-lg border p-3 text-sm ${tone}`}>{notice.message}</p>;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard(10));
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return undefined;
    const timer = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [auto, load]);

  async function runCron(storeIds = null, productName = null) {
    setRunning(true);
    setNotice(null);
    try {
      const summary = await api.runCron(storeIds);
      setNotice({
        type: summary.failed ? 'warn' : 'ok',
        message:
          `Scraped ${summary.succeeded}/${summary.total} product(s) in ${summary.durationMs}ms` +
          (summary.failed ? ` · ${summary.failed} failed (see the logs below)` : '') +
          (productName ? ` · triggered for "${productName}"` : ''),
      });
      await load();
    } catch (err) {
      setNotice({ type: 'error', message: toApiError(err).message });
    } finally {
      setRunning(false);
      setBusyId(null);
    }
  }

  async function untrack(product) {
    if (!window.confirm(`Stop tracking "${product.name}"? Its price history will be deleted too.`)) return;
    setBusyId(product.id);
    try {
      await api.untrack(product.id);
      setNotice({ type: 'ok', message: `Stopped tracking "${product.name}".` });
      await load();
    } catch (err) {
      setNotice({ type: 'error', message: toApiError(err).message });
    } finally {
      setBusyId(null);
    }
  }

  const products = data?.products || [];
  const withPrice = products.filter((p) => p.latest?.price !== null && p.latest?.price !== undefined);
  const failing = products.filter((p) => p.lastLog?.status === 'failed');
  const lastScrape = withPrice.map((p) => p.latest?.scraped_at).filter(Boolean).sort().pop();

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Tracked products</h2>
          <p className="text-sm text-slate-400">
            Latest price, stock and the most recent scrape logs for everything you track.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="accent-indigo-500"
            />
            auto-refresh {AUTO_REFRESH_MS / 1000}s
          </label>
          <button className="btn-ghost" onClick={load} disabled={loading || running}>
            Refresh
          </button>
          <button className="btn-primary" onClick={() => runCron()} disabled={running || !products.length}>
            {running ? 'Scraping...' : 'Run cron now'}
          </button>
        </div>
      </section>

      <Notice notice={notice} />
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tracked" value={products.length} hint="rows in products" />
        <StatCard label="With price" value={withPrice.length} hint="has price_history rows" />
        <StatCard label="Failing" value={failing.length} hint="latest log = failed" />
        <StatCard label="Last scrape" value={formatRelative(lastScrape)} hint={formatDateTime(lastScrape)} />
      </section>

      {loading && !data && <p className="card text-sm text-slate-400">Loading dashboard...</p>}

      {!loading && !products.length && (
        <section className="card space-y-2 text-sm text-slate-400">
          <p className="text-slate-300">Nothing tracked yet.</p>
          <p>
            Go to the <Link className="text-indigo-300 hover:text-indigo-200" to="/">Search</Link> tab, find a product and
            hit "Track Product".
          </p>
        </section>
      )}

      <section className="space-y-4">
        {products.map((product) => (
          <article key={product.id} className="card space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/products/${product.id}`}
                    className="text-base font-semibold text-white hover:text-indigo-200"
                  >
                    {product.name}
                  </Link>
                  {product.lastLog && <StatusBadge status={product.lastLog.status} />}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  SKU {product.sku || 'n/a'} · store #{product.store_id} · id {String(product.id).slice(0, 8)}...
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setBusyId(product.id);
                    runCron([product.store_id], product.name);
                  }}
                  disabled={running}
                >
                  {busyId === product.id ? 'Scraping...' : 'Scrape now'}
                </button>
                <button className="btn-ghost text-xs" onClick={() => untrack(product)} disabled={busyId === product.id}>
                  Untrack
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-slate-400">Current price</p>
                <p className="text-lg font-semibold text-white">
                  {formatMoney(product.latest?.price, product.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Stock</p>
                <p className="text-lg font-semibold tabular-nums text-white">{product.latest?.stock ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Last checked</p>
                <p className="text-sm text-slate-200">{formatRelative(product.latest?.scraped_at)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Last {product.logs.length} runs</p>
                <p className="text-sm">
                  <span className="text-emerald-300">{product.logSummary.success} ok</span>
                  <span className="text-slate-500"> · </span>
                  <span className="text-amber-300">{product.logSummary.retried} retried</span>
                  <span className="text-slate-500"> · </span>
                  <span className="text-rose-300">{product.logSummary.failed} failed</span>
                </p>
              </div>
            </div>

            <div>
              <button
                className="text-xs text-indigo-300 hover:text-indigo-200"
                onClick={() => setExpanded((prev) => ({ ...prev, [product.id]: !prev[product.id] }))}
              >
                {expanded[product.id] ? '▾ Hide scrape logs' : `▸ Show scrape logs (${product.logs.length})`}
              </button>
              {expanded[product.id] && (
                <div className="mt-2 rounded-lg border border-slate-800">
                  <LogTable logs={product.logs} />
                </div>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
