// client/src/components/StatusBadge.jsx
// Visualises a scrape_logs.status value: success | retried | failed.

const STYLES = {
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  retried: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  unknown: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

const LABELS = {
  success: 'Success',
  retried: 'Retried',
  failed: 'Failed',
  unknown: 'Unknown',
};

export default function StatusBadge({ status, className = '' }) {
  const key = STYLES[status] ? status : 'unknown';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLES[key]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[key]}
    </span>
  );
}
