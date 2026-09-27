import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db.js';
import * as L from '../src/services/ledger.js';
import * as B from '../src/services/budgets.js';
import * as D from '../src/services/debts.js';
import { computeBalances, computeTotals, summarize, budgetStatus, debtStatus, debtTotals, accountStatement } from '../src/services/calc.js';
import { createSyncEngine } from '../src/services/sync.js';
import { createFakeRemote } from './fakeRemote.js';

const P = (x) => x * 100;
let cash, gcash, food, grocery, transport, salary;

async function state(today = '2026-09-27') {
  const accounts = await db.accounts.where('user_id').equals('u1').toArray();
  const txs = await db.transactions.where('user_id').equals('u1').toArray();
  const debts = await db.debts.where('user_id').equals('u1').toArray();
  const categories = await db.categories.where('user_id').equals('u1').toArray();
  const bal = computeBalances(accounts, txs);
  return { accounts, txs, debts, categories, bal, totals: computeTotals(accounts, bal, debtTotals(debts, txs, today)) };
}
const exp = (amount, category, date, account = gcash) => L.saveTransaction({ type: 'expense', amount: P(amount), account_id: account.id, category_id: category.id, date });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  L.setActor({ userId: 'u1', device: 'test', currency: 'PHP' });
  await L.ensureDefaultCategories('u1');
  cash = await L.saveAccount({ name: 'Cash', type: 'cash', initial_balance: P(5000) });
  gcash = await L.saveAccount({ name: 'GCash', type: 'ewallet', initial_balance: P(20000) });
  const cats = await db.categories.toArray();
  food = cats.find((c) => c.name === 'Food' && c.kind === 'expense');
  transport = cats.find((c) => c.name === 'Transportation');
  salary = cats.find((c) => c.name === 'Salary');
  grocery = await L.saveCategory({ kind: 'expense', name: 'Grocery', parent_id: food.id });
});

describe('Budgets (Sec 19, 20, 75)', () => {
  it('Food ₱8,000, spent ₱6,500 → ₱1,500 left, 81.25%, warning', async () => {
    const b = await B.saveBudget({ name: 'Food', scope: 'category', category_ids: [food.id], amount: P(8000), period: 'monthly', alert_at: 80, start_date: '2026-09-01' });
    await exp(4000, food, '2026-09-05');
    await exp(2500, grocery, '2026-09-10'); // subcategory counts
    await exp(999, transport, '2026-09-10'); // other category doesn't
    await exp(300, food, '2026-08-31'); // other month doesn't
    const s = await state();
    const st = budgetStatus(b, s.txs, s.categories, '2026-09-27');
    expect(st.spent).toBe(P(6500));
    expect(st.remaining).toBe(P(1500));
    expect(st.pct).toBeCloseTo(81.25);
    expect(st.level).toBe('warning');
  });

  it('refunds reduce budget spending; reached and exceeded levels', async () => {
    const b = await B.saveBudget({ name: 'Food', scope: 'category', category_ids: [food.id], amount: P(1000), period: 'monthly', alert_at: 80 });
    await exp(1200, food, '2026-09-05');
    let s = await state();
    let st = budgetStatus(b, s.txs, s.categories, '2026-09-27');
    expect(st.level).toBe('exceeded');
    expect(-st.remaining).toBe(P(200));
    await L.saveTransaction({ type: 'refund', amount: P(200), account_id: gcash.id, category_id: food.id, date: '2026-09-06' });
    s = await state();
    st = budgetStatus(b, s.txs, s.categories, '2026-09-27');
    expect(st.level).toBe('reached');
  });

  it('rollover carries unused money: Sept ₱10,000 with ₱2,000 unused → Oct ₱12,000', async () => {
    const b = await B.saveBudget({ name: 'All', scope: 'overall', amount: P(10000), period: 'monthly', rollover: true, alert_at: 80, start_date: '2026-09-01' });
    await exp(8000, food, '2026-09-10');
    const s = await state();
    expect(budgetStatus(b, s.txs, s.categories, '2026-10-05').limit).toBe(P(12000));
    const noRoll = { ...b, rollover: false };
    expect(budgetStatus(noRoll, s.txs, s.categories, '2026-10-05').limit).toBe(P(10000));
  });

  it('overspending is not carried as a penalty', async () => {
    const b = await B.saveBudget({ name: 'All', scope: 'overall', amount: P(10000), period: 'monthly', rollover: true, alert_at: 80, start_date: '2026-09-01' });
    await exp(13000, food, '2026-09-10');
    const s = await state();
    expect(budgetStatus(b, s.txs, s.categories, '2026-10-05').limit).toBe(P(10000));
  });

  it('weekly and custom periods', async () => {
    const w = await B.saveBudget({ name: 'Week', scope: 'overall', amount: P(2000), period: 'weekly', alert_at: 80 });
    const c = await B.saveBudget({ name: 'Trip', scope: 'overall', amount: P(5000), period: 'custom', start_date: '2026-09-20', end_date: '2026-09-30', alert_at: 80 });
    await exp(500, food, '2026-09-21'); // Mon
    await exp(700, food, '2026-09-27'); // Sun (same week)
    await exp(100, food, '2026-09-19'); // previous week, before trip
    const s = await state();
    expect(budgetStatus(w, s.txs, s.categories, '2026-09-27').spent).toBe(P(1200));
    expect(budgetStatus(c, s.txs, s.categories, '2026-09-27').spent).toBe(P(1200));
  });

  it('alert fires once when crossing a threshold, not on every expense', async () => {
    await B.saveBudget({ name: 'Food', scope: 'category', category_ids: [food.id], amount: P(1000), period: 'monthly', alert_at: 80 });
    const t1 = await exp(500, food, '2026-09-05');
    expect(await B.budgetAlertsFor(t1)).toHaveLength(0);
    const t2 = await exp(350, food, '2026-09-06');
    const a2 = await B.budgetAlertsFor(t2);
    expect(a2).toHaveLength(1);
    expect(a2[0].status.level).toBe('warning');
    const t3 = await exp(10, food, '2026-09-07');
    expect(await B.budgetAlertsFor(t3)).toHaveLength(0);
    const t4 = await exp(300, food, '2026-09-08');
    expect((await B.budgetAlertsFor(t4))[0].status.level).toBe('exceeded');
  });

  it('validation', async () => {
    await expect(B.saveBudget({ name: '', scope: 'overall', amount: P(1), period: 'monthly', alert_at: 80 })).rejects.toThrow();
    await expect(B.saveBudget({ name: 'x', scope: 'category', category_ids: [], amount: P(1), period: 'monthly', alert_at: 80 })).rejects.toThrow();
    await expect(B.saveBudget({ name: 'x', scope: 'overall', amount: P(1), period: 'custom', start_date: '2026-09-10', end_date: '2026-09-01', alert_at: 80 })).rejects.toThrow();
  });
});

describe('Utang (debts)', () => {
  it('lending moves money out of an account but is not an expense; net worth unchanged', async () => {
    const before = await state();
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(5000), date: '2026-09-01', due_date: '2026-10-15', account_id: gcash.id });
    const s = await state();
    expect(s.bal.get(gcash.id)).toBe(P(15000));
    expect(s.totals.cash).toBe(before.totals.cash - P(5000));
    expect(s.totals.receivable).toBe(P(5000));
    expect(s.totals.netWorth).toBe(before.totals.netWorth);
    const sum = summarize(s.txs);
    expect(sum.expenses).toBe(0);
    expect(sum.income).toBe(0);
    expect(debtStatus(d, s.txs, '2026-09-27').status).toBe('unpaid');
  });

  it('partial payments reduce the balance and update status automatically', async () => {
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(5000), date: '2026-09-01', account_id: gcash.id });
    await D.recordPayment(d.id, { amount: P(2000), account_id: cash.id, date: '2026-09-10' });
    let s = await state();
    let st = debtStatus(d, s.txs);
    expect(st.status).toBe('partial');
    expect(st.remaining).toBe(P(3000));
    expect(st.pct).toBe(40);
    expect(s.bal.get(cash.id)).toBe(P(7000));
    await D.recordPayment(d.id, { amount: P(3000), account_id: gcash.id, date: '2026-09-20' });
    s = await state();
    st = debtStatus(d, s.txs);
    expect(st.status).toBe('paid');
    expect(st.lastPayment).toBe('2026-09-20');
    expect(s.totals.receivable).toBe(0);
    expect(summarize(s.txs).income).toBe(0); // repayment is not income
    await expect(D.recordPayment(d.id, { amount: P(1), account_id: gcash.id })).rejects.toThrow();
  });

  it('overpayment: excess becomes separate income (interest)', async () => {
    const d = await D.saveDebt({ person_name: 'Ana', direction: 'owed_to_me', amount: P(1000), date: '2026-09-01', account_id: cash.id });
    const r = await D.recordPayment(d.id, { amount: P(1100), account_id: cash.id, date: '2026-09-15' });
    expect(r.applied).toBe(P(1000));
    expect(r.excess).toBe(P(100));
    const s = await state();
    expect(debtStatus(d, s.txs).status).toBe('paid');
    expect(summarize(s.txs).income).toBe(P(100));
    expect(s.bal.get(cash.id)).toBe(P(5100));
  });

  it('overdue status after due date', async () => {
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(500), date: '2026-09-01', due_date: '2026-09-15', account_id: cash.id });
    const s = await state();
    expect(debtStatus(d, s.txs, '2026-09-16').status).toBe('overdue');
    expect(debtStatus(d, s.txs, '2026-09-15').status).toBe('unpaid');
  });

  it('old debt (no account) changes no balances; borrowing adds money and a liability', async () => {
    await D.saveDebt({ person_name: 'Pedro', direction: 'owed_to_me', amount: P(3000), date: '2026-01-01', account_id: null });
    await D.saveDebt({ person_name: 'Bank', direction: 'i_owe', amount: P(10000), date: '2026-09-01', account_id: gcash.id });
    const s = await state();
    expect(s.bal.get(cash.id)).toBe(P(5000));
    expect(s.bal.get(gcash.id)).toBe(P(30000));
    expect(s.totals.receivable).toBe(P(3000));
    expect(s.totals.payable).toBe(P(10000));
    expect(s.totals.netWorth).toBe(P(5000 + 20000 + 3000));
  });

  it('paying my own debt reduces the account, not an expense', async () => {
    const d = await D.saveDebt({ person_name: 'Tita', direction: 'i_owe', amount: P(2000), date: '2026-09-01', account_id: null });
    await D.recordPayment(d.id, { amount: P(500), account_id: gcash.id, date: '2026-09-02' });
    const s = await state();
    expect(s.bal.get(gcash.id)).toBe(P(19500));
    expect(summarize(s.txs).expenses).toBe(0);
    expect(debtStatus(d, s.txs).remaining).toBe(P(1500));
  });

  it('forgive clears the remaining without touching accounts; undo works', async () => {
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(5000), date: '2026-09-01', account_id: gcash.id });
    await D.recordPayment(d.id, { amount: P(1000), account_id: gcash.id });
    await D.forgiveDebt(d.id);
    let s = await state();
    const dd = await db.debts.get(d.id);
    expect(debtStatus(dd, s.txs).status).toBe('forgiven');
    expect(s.bal.get(gcash.id)).toBe(P(16000));
    expect(s.totals.receivable).toBe(0);
    await D.undoForgive(d.id);
    s = await state();
    expect(debtStatus(await db.debts.get(d.id), s.txs).remaining).toBe(P(4000));
  });

  it('undo a payment; delete and restore a whole debt', async () => {
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(5000), date: '2026-09-01', account_id: gcash.id });
    const { payment } = await D.recordPayment(d.id, { amount: P(1000), account_id: gcash.id });
    await D.deletePayment(payment.id);
    let s = await state();
    expect(debtStatus(d, s.txs).remaining).toBe(P(5000));
    await D.recordPayment(d.id, { amount: P(1000), account_id: gcash.id });
    await D.deleteDebt(d.id);
    s = await state();
    expect(s.bal.get(gcash.id)).toBe(P(20000)); // everything reversed
    expect(s.totals.receivable).toBe(0);
    await D.restoreDebt(d.id);
    s = await state();
    expect(s.bal.get(gcash.id)).toBe(P(16000));
    expect(s.totals.receivable).toBe(P(4000));
  });

  it('editing the amount/account keeps the principal transaction in sync', async () => {
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(5000), date: '2026-09-01', account_id: gcash.id });
    await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(4000), date: '2026-09-01', account_id: cash.id }, d.id);
    let s = await state();
    expect(s.bal.get(gcash.id)).toBe(P(20000));
    expect(s.bal.get(cash.id)).toBe(P(1000));
    await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(4000), date: '2026-09-01', account_id: null }, d.id);
    s = await state();
    expect(s.bal.get(cash.id)).toBe(P(5000));
    expect(await db.people.count()).toBe(1); // same person reused
  });

  it('account statement includes loan movements and still balances', async () => {
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(3000), date: '2026-09-01', account_id: gcash.id });
    await D.recordPayment(d.id, { amount: P(1000), account_id: gcash.id, date: '2026-09-05' });
    const s = await state();
    const st = accountStatement(gcash, s.txs, '2026-09-01', '2026-09-30');
    expect(st.debtOut).toBe(P(3000));
    expect(st.debtIn).toBe(P(1000));
    expect(st.opening + st.income - st.spent + st.refunds + st.transferIn - st.transferOut + st.adjustIn - st.adjustOut + st.debtIn - st.debtOut).toBe(st.closing);
  });

  it('generic transaction editor refuses debt transactions', async () => {
    await expect(L.saveTransaction({ type: 'debt', amount: P(1), account_id: cash.id, date: '2026-09-01' })).rejects.toThrow();
  });

  it('syncs people → debts → transactions in the right order', async () => {
    const remote = createFakeRemote();
    const engine = createSyncEngine({ remote, getUserId: () => 'u1', isOnline: () => true });
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(5000), date: '2026-09-01', account_id: gcash.id });
    await D.recordPayment(d.id, { amount: P(1000), account_id: gcash.id });
    await B.saveBudget({ name: 'Food', scope: 'category', category_ids: [food.id], amount: P(8000), period: 'monthly', alert_at: 80 });
    await engine.sync();
    expect(remote.tables.people.size).toBe(1);
    expect(remote.tables.debts.size).toBe(1);
    expect(remote.tables.budgets.size).toBe(1);
    expect([...remote.tables.transactions.values()].filter((t) => t.debt_id === d.id)).toHaveLength(2);
    expect(engine.getState().pending).toBe(0);
  });
});

describe('Utang guards', () => {
  it('payment without an account is a validation error, not a crash', async () => {
    const d = await D.saveDebt({ person_name: 'Juan', direction: 'owed_to_me', amount: P(500), date: '2026-09-01', account_id: cash.id });
    await expect(D.recordPayment(d.id, { amount: P(100), account_id: undefined })).rejects.toBeInstanceOf(L.ValidationError);
  });
});
