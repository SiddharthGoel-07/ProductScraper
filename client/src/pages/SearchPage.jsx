// client/src/pages/SearchPage.jsx
// Search bar -> GET /api/search -> results with a "Track Product" button that
// POSTs /api/track (which also performs the first price scrape).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import { api, formatMoney, toApiError } from '../api';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [trackingId, setTrackingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [trackedNow, setTrackedNow] = useState({}); // storeId -> { id, status, price }

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      setData(await api.search(q));
    } catch (err) {
      setError(toApiError(err).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack(item) {
    setTrackingId(item.id);
    setNotice(null);
    try {
      const product = await api.track({ storeId: item.id, name: item.name, sku: item.sku });
      setTrackedNow((prev) => ({
        ...prev,
        [item.id]: {
          id: product.id,
          ok: product.scrape?.ok,
          status: product.scrape?.status,
          price: product.scrape?.price,
          stock: product.scrape?.stock,
          error: product.scrape?.lastError,
        },
      }));
      setNotice({ type: 'ok', message: `"${item.name}" is now tracked.` });
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.data?.alreadyTracked) {
        setTrackedNow((prev) => ({
          ...prev,
          [item.id]: { id: apiError.data.product?.id, already: true },
        }));
        setNotice({ type: 'warn', message: `"${item.name}" is already tracked.` });
      } else {
        setNotice({ type: 'error', message: apiError.message });
      }
    } finally {
      setTrackingId(null);
    }
  }

  const results = data?.results || [];

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Search the store catalog</h2>
          <p className="text-sm text-slate-400">
            Calls <code className="text-slate-300">scraper.searchCatalog(q)</code> on the backend. The first search of a
            term walks every catalog page, so it can take 15-60 seconds.
          </p>
        </div>

        <SearchBar value={query} onChange={setQuery} onSubmit={handleSearch} loading={loading} />

        {loading && (
          <p className="text-sm text-indigo-300">
            Searching the live store... this is the slow path (catalog paging with rate-limit delays).
          </p>
        )}
        {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        {notice && (
          <p
            className={`rounded-lg border p-3 text-sm ${
              notice.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : notice.type === 'warn'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
            }`}
          >
            {notice.message}
          </p>
        )}
      </section>

      {data && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-white">
              {data.count} match{data.count === 1 ? '' : 'es'} for "{data.query}"
            </h3>
            <span className="text-xs text-slate-400">
              {data.cached ? 'cached' : 'live'} · {data.durationMs}ms
            </span>
          </div>

          {!results.length && (
            <p className="card text-sm text-slate-400">
              No products matched that query. Try a shorter term (e.g. "boot").
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {results.map((item) => {
              const tracked =
                trackedNow[item.id] ||
                (item.tracked ? { id: item.trackedProductId, already: true } : null);

              return (
                <article key={item.id} className="card flex flex-col justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium text-white">{item.name}</h4>
                      <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                        #{item.id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {item.brand || 'Unknown brand'} · {item.category || 'Uncategorised'}
                    </p>
                    <p className="text-xs text-slate-500">SKU {item.sku || 'n/a'}</p>
                    {item.price !== null && item.price !== undefined && (
                      <p className="text-sm text-slate-300">Catalog price {formatMoney(item.price)}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    {tracked ? (
                      <div className="flex items-center gap-2">
                        {tracked.status && <StatusBadge status={tracked.status} />}
                        {tracked.id ? (
                          <Link to={`/products/${tracked.id}`} className="text-sm text-indigo-300 hover:text-indigo-200">
                            View product →
                          </Link>
                        ) : (
                          <span className="text-sm text-amber-300">already tracked</span>
                        )}
                      </div>
                    ) : (
                      <button
                        className="btn-primary"
                        onClick={() => handleTrack(item)}
                        disabled={trackingId === item.id}
                      >
                        {trackingId === item.id ? 'Tracking...' : 'Track Product'}
                      </button>
                    )}

                    {tracked?.price !== undefined && tracked?.price !== null && (
                      <span className="text-xs text-slate-400">first quote {formatMoney(tracked.price)}</span>
                    )}
                  </div>

                  {tracked?.error && (
                    <p className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
                      First scrape failed: {tracked.error}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
