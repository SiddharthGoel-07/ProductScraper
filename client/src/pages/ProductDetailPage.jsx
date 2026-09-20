// client/src/pages/ProductDetailPage.jsx
// Single product view: price_history chart, current stock, price stats and the
// scrape_logs table (successes vs failures).

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import LogTable from '../components/LogTable';
import StatusBadge from '../components/StatusBadge';
import { api, formatDateTime, formatMoney, formatRelative, toApiError } from '../api';

const AXIS = { stroke: '#64748b', fontSize: 12 };
const TOOLTIP_STYLE = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  color: '#e2e8f0',
};

function Stat({ label, value, hint }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function toChartData(history = []) {
  return history.map((point) => {
    const date = new Date(point.scraped_at);
    return {
      ts: date.getTime(),
      label: Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      price: point.price,
      stock: point.stock,
    };
  });
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [scraping, setScraping] = useState(false);

  const load = useCallback(async () => {
    try {
      setProduct(await api.product(id));
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function scrapeNow() {
    setScraping(true);
    setNotice(null);
    try {
      const summary = await api.runCron([product.store_id]);
      const result = summary.results?.[0];
      setNotice({
        type: result?.ok ? 'ok' : 'warn',
        message: result?.ok
          ? `Scraped in ${result.attempts} attempt(s): ${formatMoney(result.price, product.currency)}, stock ${result.stock}`
          : `Scrape failed after ${result?.attempts ?? 0} attempt(s): ${result?.lastError || 'unknown error'}`,
      });
      await load();
    } catch (err) {
      setNotice({ type: 'error', message: toApiError(err).message });
    } finally {
      setScraping(false);
    }
  }

  async function untrack() {
    if (!window.confirm(`Stop tracking "${product.name}" and delete its history?`)) return;
    try {
      await api.untrack(product.id);
      navigate('/dashboard');
    } catch (err) {
      setNotice({ type: 'error', message: toApiError(err).message });
    }
  }

  if (loading) return <p className="card text-sm text-slate-400">Loading product…</p>;
  if (error) {
    return (
      <div className="card space-y-3">
        <p className="text-sm text-rose-300">{error}</p>
        <Link to="/dashboard" className="text-sm text-indigo-300 hover:text-indigo-200">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const history = product.history || [];
  const chartData = toChartData(history);
  const stats = product.stats || {};
  const currency = product.currency || 'INR';
  const change = stats.changePct;

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link to="/dashboard" className="text-xs text-indigo-300 hover:text-indigo-200">
            ← Back to dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{product.name}</h2>
            {product.lastLog && <StatusBadge status={product.lastLog.status} />}
          </div>
          <p className="text-xs text-slate-400">
            SKU {product.sku || 'n/a'} · store #{product.store_id} · {currency} · last checked{' '}
            {formatRelative(product.latest?.scraped_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={load} disabled={scraping}>
            Refresh
          </button>
          <button className="btn-primary" onClick={scrapeNow} disabled={scraping}>
            {scraping ? 'Scraping…' : 'Scrape now'}
          </button>
          <button className="btn-ghost" onClick={untrack}>
            Untrack
          </button>
        </div>
      </section>

      {notice && (
        <p
          className={`rounded-lg border p-3 text-sm ${
            notice.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
        >
          {notice.message}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Current price"
          value={formatMoney(product.latest?.price, currency)}
          hint={product.latest?.scraped_at ? formatDateTime(product.latest.scraped_at) : 'no data yet'}
        />
        <Stat
          label="Stock"
          value={product.latest?.stock ?? '—'}
          hint={product.latest?.stock === 0 ? 'out of stock' : 'units available'}
        />
        <Stat
          label="Change (window)"
          value={change === null || change === undefined ? '—' : `${change > 0 ? '+' : ''}${change}%`}
          hint={`${stats.points ?? 0} data point(s)`}
        />
        <Stat
          label="Min / avg / max"
          value={`${formatMoney(stats.min, currency)}`}
          hint={`avg ${formatMoney(stats.avg, currency)} · max ${formatMoney(stats.max, currency)}`}
        />
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-white">Price history</h3>
          <span className="text-xs text-slate-400">
            {chartData.length} point(s) from <code className="text-slate-400">price_history</code>
          </span>
        </div>

        {chartData.length < 2 ? (
          <p className="rounded-lg border border-dashed border-slate-800 p-6 text-sm text-slate-400">
            Not enough history to chart yet ({chartData.length} point). Hit <strong>Scrape now</strong> a few times or let
            the cron job run to accumulate data.
          </p>
        ) : (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" tick={AXIS} minTickGap={24} />
                  <YAxis tick={AXIS} domain={['auto', 'auto']} width={80} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => [formatMoney(value, currency), 'Price']}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#818cf8' }}
                    activeDot={{ r: 5 }}
                    name="Price"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <defs>
                    <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" tick={AXIS} minTickGap={24} />
                  <YAxis tick={AXIS} width={80} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [value, 'Stock']} />
                  <Area
                    type="stepAfter"
                    dataKey="stock"
                    stroke="#34d399"
                    fill="url(#stockFill)"
                    strokeWidth={2}
                    name="Stock"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-white">Scrape logs</h3>
          <span className="text-xs text-slate-400">
            latest {product.logs?.length ?? 0} run(s) ·{' '}
            <span className="text-emerald-300">{product.logSummary?.success ?? 0} success</span>
            {' · '}
            <span className="text-amber-300">{product.logSummary?.retried ?? 0} retried</span>
            {' · '}
            <span className="text-rose-300">{product.logSummary?.failed ?? 0} failed</span>
          </span>
        </div>
        <LogTable logs={product.logs || []} emptyMessage="No scrape logs yet for this product." />
      </section>
    </div>
  );
}
