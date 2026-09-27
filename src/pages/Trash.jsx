import { RotateCcw, Trash2 } from 'lucide-react';
import { useAccounts, useCategories, useTrash } from '../hooks/useData.js';
import { PageHeader, useConfirm, useToast } from '../components/ui.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import * as L from '../services/ledger.js';
import { formatMoney } from '../lib/money.js';
import { friendlyDate } from '../lib/dates.js';

export default function Trash() {
  const items = useTrash();
  const accountsList = useAccounts();
  const cats = useCategories();
  const confirm = useConfirm();
  const toast = useToast();
  if (!items || !accountsList || !cats) return <div className="skeleton h-64" />;
  const accounts = new Map(accountsList.map((a) => [a.id, a]));
  // include trashed accounts for names
  items.filter((i) => i.kind === 'account').forEach((i) => accounts.set(i.item.id, i.item));

  async function purge(t) {
    const ok = await confirm({ title: 'Delete permanently?', message: 'This action cannot be undone. The transaction and its details will be erased on all your devices.', confirmLabel: 'Delete forever', danger: true });
    if (!ok) return;
    await L.purgeTransaction(t.id);
    toast('Permanently deleted');
  }

  return (
    <div>
      <PageHeader title="Trash" subtitle="Deleted items stay here until you restore or permanently delete them" />
      {!items.length ? <div className="card"><EmptyState art="receipt" title="Trash is empty" body="Deleted transactions and accounts appear here so you can restore them." /></div> : (
        <div className="card p-1.5 sm:p-2">
          {items.map(({ kind, item }) => {
            const acc = accounts.get(item.account_id);
            const title = kind === 'account' ? `Account: ${item.name}` : `${item.payee || (item.category_id ? cats.label(item.category_id) : item.type)} · ${formatMoney(item.amount, acc?.currency)}`;
            const sub = kind === 'account' ? 'No transactions' : `${item.type} · ${acc?.name || ''} · ${friendlyDate(item.date)}`;
            return (
              <div key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex-1 min-w-0"><span className="block font-medium truncate">{title}</span><span className="block text-[12.5px] muted truncate capitalize">{sub}</span></span>
                <button className="btn-soft btn-sm" onClick={() => (kind === 'account' ? L.restoreAccount(item.id) : L.restoreTransaction(item.id)).then(() => toast('Restored'))}><RotateCcw size={15} /> Restore</button>
                {kind === 'transaction' && <button className="icon-btn text-loss" onClick={() => purge(item)} aria-label="Delete permanently"><Trash2 size={17} /></button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
