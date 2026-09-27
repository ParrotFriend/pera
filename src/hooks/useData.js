import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.js';
import { useApp } from '../services/app.jsx';
import { computeBalances, computeTotals, debtTotals } from '../services/calc.js';

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
  const debts = useDebts();
  return useMemo(() => {
    if (!accounts || !txs || !debts) return undefined;
    const balances = computeBalances(accounts, txs);
    return { accounts, txs, debts, balances, totals: computeTotals(accounts, balances, debtTotals(debts, txs)) };
  }, [accounts, txs, debts]);
}

export function useBudgets() {
  const { user } = useApp();
  return useLiveQuery(() => (user ? db.budgets.where('user_id').equals(user.id).filter((b) => !b.deleted_at).toArray() : []), [user?.id]);
}

export function useDebts() {
  const { user } = useApp();
  return useLiveQuery(() => (user ? db.debts.where('user_id').equals(user.id).filter((d) => !d.deleted_at).toArray() : []), [user?.id]);
}

export function usePeople() {
  const { user } = useApp();
  const rows = useLiveQuery(() => (user ? db.people.where('user_id').equals(user.id).filter((p) => !p.deleted_at).toArray() : []), [user?.id]);
  return useMemo(() => (rows ? new Map(rows.map((p) => [p.id, p])) : undefined), [rows]);
}

export function useTrash() {
  const { user } = useApp();
  return useLiveQuery(async () => {
    if (!user) return EMPTY;
    const [tx, acc, debts] = await Promise.all([
      db.transactions.where('user_id').equals(user.id).filter((t) => !!t.deleted_at && !t.purged_at).toArray(),
      db.accounts.where('user_id').equals(user.id).filter((a) => !!a.deleted_at).toArray(),
      db.debts.where('user_id').equals(user.id).filter((d) => !!d.deleted_at).toArray()
    ]);
    // Movements trashed together with a debt are restored through the debt, not one by one.
    const debtTrash = new Set(debts.map((d) => `${d.id}|${d.deleted_at}`));
    const loose = tx.filter((t) => !(t.debt_id && debtTrash.has(`${t.debt_id}|${t.deleted_at}`)));
    return [...loose.map((t) => ({ kind: 'transaction', item: t })), ...acc.map((a) => ({ kind: 'account', item: a })), ...debts.map((d) => ({ kind: 'debt', item: d }))]
      .sort((a, b) => b.item.deleted_at.localeCompare(a.item.deleted_at));
  }, [user?.id]);
}
