// client/src/components/LogTable.jsx
// scrape_logs table - the explicit "successes vs failures" view.
// Every row shows the status badge, how many attempts it took, the error
// message (when any) and when it happened.

import StatusBadge from './StatusBadge';
import { formatDateTime, formatRelative } from '../api';

export default function LogTable({ logs = [], emptyMessage = 'No scrape runs logged yet.', compact = false }) {
  if (!logs.length) {
    return <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-800">
        <thead className="bg-slate-900/60">
          <tr>
            <th className="th">Status</th>
            <th className="th">Attempts</th>
            {!compact && <th className="th">When</th>}
            <th className="th">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {logs.map((log, index) => (
            <tr key={log.id || `${log.created_at}-${index}`} className="hover:bg-slate-900/40">
              <td className="td">
                <StatusBadge status={log.status} />
              </td>
              <td className="td tabular-nums">{log.attempts ?? '—'}</td>
              {!compact && (
                <td className="td whitespace-nowrap">
                  <span className="text-slate-200">{formatRelative(log.created_at)}</span>
                  <span className="block text-xs text-slate-500">{formatDateTime(log.created_at)}</span>
                </td>
              )}
              <td className="td max-w-md">
                {log.error_message ? (
                  <span className="break-words text-rose-300/90">{log.error_message}</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
