import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw } from 'lucide-react';
import { db } from '../db/db.js';
import { useApp } from '../services/app.jsx';
import { useAccounts, useCategories } from '../hooks/useData.js';
import { PageHeader } from '../components/ui.jsx';
import { useSyncLabel } from '../components/SyncBadge.jsx';
import { formatMoney } from '../lib/money.js';
import { Link } from 'react-router-dom';

const FIELD_LABELS = { amount: 'Amount', type: 'Type', account_id: 'Account', to_account_id: 'To account', category_id: 'Category', date: 'Date', time: 'Time', payee: 'Merchant', notes: 'Notes', tags: 'Tags', deleted_at: 'In Trash', name: 'Name', initial_balance: 'Starting balance', archived_at: 'Archived', color: 'Color', low_balance_threshold: 'Low balance alert' };

export default function Sync() {
  const { user, engine, sync, online, cloudEnabled } = useApp();
  const label = useSyncLabel();
  const conflicts = useLiveQuery(() => (user ? db.conflicts.where('user_id').equals(user.id).toArray() : []), [user?.id]);
  const locals = useLiveQuery(async () => {
    if (!conflicts) return {};
    const out = {};
    for (const c of conflicts) out[c.key] = await db[c.table].get(c.record_id);
    return out;
  }, [conflicts]);
  const failing = useLiveQuery(() => (user ? db.outbox.where('user_id').equals(user.id).filter((e) => !!e.last_error).count() : 0), [user?.id]);
  const accounts = useAccounts();
  const cats = useCategories();
  const accMap = new Map((accounts || []).map((a) => [a.id, a]));
  const show = (k, v, table) => {
    if (v == null || v === '') return '—';
    if (k === 'amount' || k === 'initial_balance' || k === 'low_balance_threshold') return formatMoney(v);
    if (k === 'account_id' || k === 'to_account_id') return accMap.get(v)?.name || '—';
    if (k === 'category_id') return cats?.label(v) || '—';
    if (k === 'tags') return v.length ? v.map((t) => '#' + t).join(' ') : '—';
    if (k === 'deleted_at' || k === 'archived_at') return 'Yes';
    return String(v);
  };

  if (user?.local) {
    return (
      <div>
        <PageHeader title="Sync" />
        <div className="card p-5 text-[15px] leading-relaxed">
          <p>Pera is running in <strong>device-only mode</strong>. Everything is stored on this device and works fully offline, but it is not backed up to the cloud or shared with your other devices.</p>
          <p className="muted mt-3">To enable accounts and sync, add your Supabase URL and key to the app's environment settings (see the README). Meanwhile, use <Link className="underline" to="/settings">Settings → Backup</Link> to keep a copy of your data.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Sync" subtitle={online ? 'Connected' : 'No internet connection'} />
      <section className="card p-5">
        <p className="text-lg font-semibold">{label.text}</p>
        <p className="text-sm muted mt-1">
          {sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not synced yet on this device.'}
          {' '}Changes are saved on this device first, then sent to the cloud automatically.
        </p>
        {sync.lastError && <p className="text-sm text-warn mt-2">{sync.lastError}</p>}
        {failing > 0 && <p className="text-sm text-warn mt-2">{failing} change{failing > 1 ? 's' : ''} failed to upload and will be retried.</p>}
        <button className="btn-soft btn-sm mt-4" disabled={!online || sync.status === 'syncing' || user?.offlineOnly} onClick={() => engine.retryNow()}>
          <RefreshCw size={15} className={sync.status === 'syncing' ? 'animate-spin' : ''} /> Retry sync now
        </button>
        {user?.offlineOnly && online && <p className="text-sm mt-3">Your session expired while offline. <Link className="underline" to="/settings">Sign in again</Link> to resume syncing. Your changes are safe on this device.</p>}
      </section>

      {conflicts?.length > 0 && (
        <section className="mt-6" aria-labelledby="conf-h">
          <h2 id="conf-h" className="text-lg font-semibold mb-1">Needs review</h2>
          <p className="text-sm muted mb-3">These records were changed on this device and on another device before they could sync. Choose which version to keep — nothing is overwritten until you decide.</p>
          <div className="space-y-4">
            {conflicts.map((c) => {
              const local = locals?.[c.key];
              if (!local) return null;
              const keys = Object.keys(FIELD_LABELS).filter((k) => k in c.server || k in local).filter((k) => JSON.stringify(local[k] ?? null) !== JSON.stringify(c.server[k] ?? null));
              return (
                <div key={c.key} className="card p-4">
                  <p className="font-medium">This {c.table === 'transactions' ? 'transaction' : c.table.slice(0, -1)} was changed on another device.</p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="muted text-left"><th className="py-1.5 pr-3 font-medium">Field</th><th className="py-1.5 pr-3 font-medium">This device</th><th className="py-1.5 font-medium">Other device</th></tr></thead>
                      <tbody>
                        {keys.map((k) => <tr key={k} className="border-t border-ink-100/70 dark:border-night-line"><td className="py-2 pr-3 muted">{FIELD_LABELS[k]}</td><td className="py-2 pr-3 font-medium">{show(k, local[k])}</td><td className="py-2 font-medium">{show(k, c.server[k])}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button className="btn-primary btn-sm" onClick={() => engine.resolveConflict(c.key, 'local')}>Keep this device's version</button>
                    <button className="btn-soft btn-sm" onClick={() => engine.resolveConflict(c.key, 'server')}>Keep other device's version</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {!cloudEnabled && null}
    </div>
  );
}
