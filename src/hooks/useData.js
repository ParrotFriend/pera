import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.js';
import { useApp } from '../services/app.jsx';
import { computeBalances, computeTotals } from '../services/calc.js';

const EMPTY = [];

export function useAccounts({ includeArchived = true } = {}) {
  const { user } = useApp();
  const rows = useLiveQuery(() => (user ? db.accounts.where('user_id').equals(user.id).filter((a) => !a.deleted_at).toArray() : []), [user?.id]);
  return useMemo(() => {
    if (!rows) return undefined;
    const list = rows.filter((a) => includeArchived || !a.archived_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    return list;
  }, [rows, includeArchived]);
}

export function useCategories() {
  const { user } = useApp();
  const rows = useLiveQuery(() => (user ? db.categories.where('user_id').equals(user.id).filter((c) => !c.deleted_at).toArray() : []), [user?.id]);
  return useMemo(() => {
    if (!rows) return undefined;
    const byId = new Map(rows.map((c) => [c.id, c]));
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    return {
      all: sorted, byId,
      expense: sorted.filter((c) => c.kind === 'expense' && !c.archived_at),
      income: sorted.filter((c) => c.kind === 'income' && !c.archived_at),
      label: (id) => { const c = byId.get(id); if (!c) return 'Uncategorized'; const p = c.parent_id && byId.get(c.parent_id); return p ? `${p.name} › ${c.name}` : c.name; }
    };
  }, [rows]);
}

/** Every live transaction for the user (the ledger). Used for balances and reports. */
export function useLedger() {
  const { user } = useApp();
  const txs = useLiveQuery(() => (user ? db.transactions.where('user_id').equals(user.id).filter((t) => !t.deleted_at && !t.purged_at).toArray() : []), [user?.id]);
  return txs;
}

export function useBalances() {
  const accounts = useAccounts();
  const txs = useLedger();
  return useMemo(() => {
    if (!accounts || !txs) return undefined;
    const balances = computeBalances(accounts, txs);
    return { accounts, txs, balances, totals: computeTotals(accounts, balances) };
  }, [accounts, txs]);
}

export function useTrash() {
  const { user } = useApp();
  return useLiveQuery(async () => {
    if (!user) return EMPTY;
    const [tx, acc] = await Promise.all([
      db.transactions.where('user_id').equals(user.id).filter((t) => !!t.deleted_at && !t.purged_at).toArray(),
      db.accounts.where('user_id').equals(user.id).filter((a) => !!a.deleted_at).toArray()
    ]);
    return [...tx.map((t) => ({ kind: 'transaction', item: t })), ...acc.map((a) => ({ kind: 'account', item: a }))]
      .sort((a, b) => b.item.deleted_at.localeCompare(a.item.deleted_at));
  }, [user?.id]);
}
