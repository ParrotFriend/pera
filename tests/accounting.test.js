import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db.js';
import * as L from '../src/services/ledger.js';
import { computeBalances, computeTotals, summarize, accountStatement } from '../src/services/calc.js';
import { toLocalDate } from '../src/lib/dates.js';

const P = (pesos) => pesos * 100;
const today = toLocalDate();
let cash, gcash, food, salary;

async function snapshot() {
  const accounts = await db.accounts.where('user_id').equals('u1').toArray();
  const txs = await db.transactions.where('user_id').equals('u1').toArray();
  const bal = computeBalances(accounts, txs);
  return { accounts, txs, bal, totals: computeTotals(accounts, bal) };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  L.setActor({ userId: 'u1', device: 'test', currency: 'PHP' });
  await L.ensureDefaultCategories('u1');
  cash = await L.saveAccount({ name: 'Cash', type: 'cash', initial_balance: P(5000) });
  gcash = await L.saveAccount({ name: 'GCash', type: 'ewallet', initial_balance: P(5000) });
  food = await db.categories.where('[user_id+kind]').equals(['u1', 'expense']).filter((c) => c.name === 'Food').first();
  salary = await db.categories.where('[user_id+kind]').equals(['u1', 'income']).filter((c) => c.name === 'Salary').first();
});

describe('Section 87 — critical accounting scenario', () => {
  it('expense, income and transfer produce exact balances; transfer is not income/expense', async () => {
    await L.saveTransaction({ type: 'expense', amount: P(500), account_id: gcash.id, category_id: food.id, date: today });
    let s = await snapshot();
    expect(s.bal.get(gcash.id)).toBe(P(4500));

    await L.saveTransaction({ type: 'income', amount: P(2000), account_id: cash.id, category_id: salary.id, date: today });
    s = await snapshot();
    expect(s.bal.get(cash.id)).toBe(P(7000));

    await L.saveTransaction({ type: 'transfer', amount: P(1000), account_id: cash.id, to_account_id: gcash.id, date: today });
    s = await snapshot();
    expect(s.bal.get(cash.id)).toBe(P(6000));
    expect(s.bal.get(gcash.id)).toBe(P(5500));
    expect(s.totals.cash).toBe(P(11500));

    const sum = summarize(s.txs, { from: today, to: today });
    expect(sum.income).toBe(P(2000));
    expect(sum.expenses).toBe(P(500));
  });

  it('transfer is a single atomic record (both sides or neither)', async () => {
    await L.saveTransaction({ type: 'transfer', amount: P(1000), account_id: cash.id, to_account_id: gcash.id, date: today });
    const t = await db.transactions.toArray();
    expect(t).toHaveLength(1);
    expect(t[0].account_id).toBe(cash.id);
    expect(t[0].to_account_id).toBe(gcash.id);
  });

  it('rejects invalid transactions and writes nothing', async () => {
    await expect(L.saveTransaction({ type: 'expense', amount: 0, account_id: gcash.id, category_id: food.id, date: today })).rejects.toThrow();
    await expect(L.saveTransaction({ type: 'expense', amount: P(10), account_id: 'nope', category_id: food.id, date: today })).rejects.toThrow();
    await expect(L.saveTransaction({ type: 'transfer', amount: P(10), account_id: cash.id, to_account_id: cash.id, date: today })).rejects.toThrow();
    await expect(L.saveTransaction({ type: 'expense', amount: P(10), account_id: cash.id, category_id: salary.id, date: today })).rejects.toThrow();
    await expect(L.saveTransaction({ type: 'expense', amount: P(10), account_id: cash.id, category_id: food.id, date: '2026-02-30' })).rejects.toThrow();
    expect(await db.transactions.count()).toBe(0);
  });

  it('editing and soft-deleting recompute balances; restore brings it back', async () => {
    const e = await L.saveTransaction({ type: 'expense', amount: P(500), account_id: gcash.id, category_id: food.id, date: today });
    await L.saveTransaction({ type: 'expense', amount: P(750), account_id: gcash.id, category_id: food.id, date: today }, e.id);
    expect((await snapshot()).bal.get(gcash.id)).toBe(P(4250));
    await L.deleteTransaction(e.id);
    expect((await snapshot()).bal.get(gcash.id)).toBe(P(5000));
    expect(await db.transactions.count()).toBe(1); // soft deleted, not destroyed
    await L.restoreTransaction(e.id);
    expect((await snapshot()).bal.get(gcash.id)).toBe(P(4250));
  });

  it('refund reduces spending and restores balance without touching the original expense', async () => {
    await L.saveTransaction({ type: 'expense', amount: P(1000), account_id: gcash.id, category_id: food.id, date: today });
    await L.saveTransaction({ type: 'refund', amount: P(300), account_id: gcash.id, category_id: food.id, date: today });
    const s = await snapshot();
    const sum = summarize(s.txs, { from: today, to: today });
    expect(s.bal.get(gcash.id)).toBe(P(4300));
    expect(sum.expenses).toBe(P(700));
    expect(sum.income).toBe(0);
    expect(sum.byCategory.get(food.id)).toBe(P(700));
  });

  it('credit card purchase and payment do not double count', async () => {
    const card = await L.saveAccount({ name: 'Visa', type: 'credit_card', initial_balance: 0 });
    await L.saveTransaction({ type: 'expense', amount: P(2000), account_id: card.id, category_id: food.id, date: today });
    await L.saveTransaction({ type: 'transfer', amount: P(2000), account_id: gcash.id, to_account_id: card.id, date: today });
    const s = await snapshot();
    const sum = summarize(s.txs, { from: today, to: today });
    expect(sum.expenses).toBe(P(2000)); // counted once, at purchase
    expect(s.bal.get(card.id)).toBe(0);
    expect(s.totals.liabilities).toBe(0);
    expect(s.totals.netWorth).toBe(P(8000));
  });

  it('reconciliation adds a visible adjustment instead of editing history', async () => {
    await L.saveTransaction({ type: 'expense', amount: P(250), account_id: gcash.id, category_id: food.id, date: today });
    await L.reconcile(gcash.id, P(4500)); // recorded 4750, actual 4500
    const s = await snapshot();
    expect(s.bal.get(gcash.id)).toBe(P(4500));
    const adj = s.txs.find((t) => t.type === 'adjustment');
    expect(adj.amount).toBe(P(250));
    expect(adj.direction).toBe('out');
    expect(summarize(s.txs).expenses).toBe(P(250)); // adjustment not counted as spending
  });

  it('account with history is archived, not deleted', async () => {
    await L.saveTransaction({ type: 'expense', amount: P(10), account_id: cash.id, category_id: food.id, date: today });
    expect(await L.removeAccount(cash.id)).toBe('archived');
    const a = await db.accounts.get(cash.id);
    expect(a.deleted_at).toBeNull();
    expect(a.archived_at).toBeTruthy();
  });

  it('every write is queued for sync and audited', async () => {
    await L.saveTransaction({ type: 'expense', amount: P(10), account_id: cash.id, category_id: food.id, date: today });
    const t = await db.transactions.toArray();
    expect(t[0].sync_status).toBe('pending');
    expect(await db.outbox.where('key').equals(`transactions:${t[0].id}`).count()).toBe(1);
    expect(await db.audit_logs.filter((l) => l.entity_id === t[0].id).count()).toBe(1);
  });

  it('account statement: opening + movements = closing', async () => {
    await L.saveTransaction({ type: 'income', amount: P(5000), account_id: gcash.id, category_id: salary.id, date: today });
    await L.saveTransaction({ type: 'expense', amount: P(2500), account_id: gcash.id, category_id: food.id, date: today });
    await L.saveTransaction({ type: 'transfer', amount: P(1000), account_id: cash.id, to_account_id: gcash.id, date: today });
    const s = await snapshot();
    const st = accountStatement(gcash, s.txs, today, today);
    expect(st.opening).toBe(P(5000));
    expect(st.closing).toBe(P(8500));
    expect(st.opening + st.income - st.expenses + st.transferIn - st.transferOut).toBe(st.closing);
  });

  it('default categories get the same ids on every device', async () => {
    const ids1 = (await db.categories.toArray()).map((c) => c.id).sort();
    await db.categories.clear();
    await L.ensureDefaultCategories('u1');
    const ids2 = (await db.categories.toArray()).map((c) => c.id).sort();
    expect(ids2).toEqual(ids1);
  });
});
