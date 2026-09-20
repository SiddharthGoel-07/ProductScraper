// src/api.js
// Single axios instance + one function per backend route.
// The Vite dev proxy forwards /api -> http://localhost:5000.

import axios from 'axios';

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 90000, // searchCatalog() legitimately needs ~20-60s on a cold cache
});

/** Turns an axios error into a predictable { message, status, data } shape. */
export function toApiError(error) {
  if (error.response) {
    return {
      status: error.response.status,
      message: error.response.data?.error || `Request failed (${error.response.status})`,
      data: error.response.data,
    };
  }
  if (error.code === 'ECONNABORTED') {
    return { status: 0, message: 'Request timed out - the store may be slow. Try again.' };
  }
  return { status: 0, message: error.message || 'Network error - is the API running on port 5000?' };
}

export const api = {
  async health() {
    const { data } = await http.get('/health');
    return data;
  },

  async search(query, maxPages) {
    const { data } = await http.get('/search', {
      params: { q: query, ...(maxPages ? { maxPages } : {}) },
    });
    return data;
  },

  async track({ storeId, name, sku }) {
    const { data } = await http.post('/track', { storeId, name, sku });
    return data;
  },

  async dashboard(logLimit = 10) {
    const { data } = await http.get('/dashboard', { params: { logLimit } });
    return data;
  },

  async product(id) {
    const { data } = await http.get(`/products/${id}`);
    return data;
  },

  async untrack(id) {
    await http.delete(`/products/${id}`);
  },

  async runCron(storeIds = null) {
    const { data } = await http.post('/cron/scrape', storeIds ? { storeIds } : {});
    return data;
  },
};

const formatterCache = new Map();

/** Currency formatting; the store quotes INR. */
export function formatMoney(value, currency = 'INR') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const key = currency || 'INR';
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.NumberFormat('en-IN', { style: 'currency', currency: key }));
  }
  return formatterCache.get(key).format(Number(value));
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(value) {
  if (!value) return 'never';
  const ms = Date.now() - new Date(value).getTime();
  if (Number.isNaN(ms)) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default http;
