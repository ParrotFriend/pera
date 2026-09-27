import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.js';
import { useApp } from '../services/app.jsx';
import { PageHeader } from '../components/ui.jsx';
import { EmptyState } from '../components/Illustrations.jsx';

const ACTION_LABEL = { created: 'Created', updated: 'Edited', deleted: 'Deleted', restored: 'Restored', archived: 'Archived', transferred: 'Transfer', purged: 'Erased', adjusted: 'Adjusted', synced: 'Synced' };

export default function Activity() {
  const { user } = useApp();
  const [limit, setLimit] = useState(80);
  const rows = useLiveQuery(() => (user ? db.audit_logs.where('[user_id+at]').between([user.id, ''], [user.id, '\uffff']).reverse().limit(limit).toArray() : []), [user?.id, limit]);
  return (
    <div>
      <PageHeader title="Activity log" subtitle="Every change to your financial records — what, when and on which device" />
      {!rows ? <div className="skeleton h-64" /> : !rows.length ? <div className="card"><EmptyState art="chart" title="No activity yet" /></div> : (
        <ol className="card p-2 divide-y divide-ink-100/70 dark:divide-night-line">
          {rows.map((r) => (
            <li key={r.id} className="px-3 py-3">
              <div className="flex justify-between gap-3 text-[12.5px] muted">
                <span className="font-semibold uppercase-none">{ACTION_LABEL[r.action] || r.action}</span>
                <time dateTime={r.at}>{new Date(r.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {r.device}</time>
              </div>
              <p className="text-[14.5px] mt-0.5">{r.summary}</p>
            </li>
          ))}
        </ol>
      )}
      {rows?.length >= limit && <div className="flex justify-center mt-4"><button className="btn-soft" onClick={() => setLimit(limit + 80)}>Show more</button></div>}
    </div>
  );
}
