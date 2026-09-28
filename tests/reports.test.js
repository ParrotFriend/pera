import { describe, it, expect } from 'vitest';
import * as R from '../src/services/reports.js';

const P = (x) => x * 100;
const cats = [
  { id: 'food', name: 'Food', kind: 'expense' }, { id: 'grocery', name: 'Grocery', kind: 'expense', parent_id: 'food' },
  { id: 'transport', name: 'Transportation', kind: 'expense' }, { id: 'salary', name: 'Salary', kind: 'income' }
];
let n = 0;
const tx = (type, amount, date, extra = {}) => ({ id: `t${n++}`, type, amount: P(amount), date, time: '12:00', account_id: 'gcash', category_id: null, tags: [], ...extra });
const txs = [
  tx('income', 20000, '2026-09-15', { category_id: 'salary' }),
  tx('expense', 500, '2026-09-02', { category_id: 'food' }),
  tx('expense', 1500, '2026-09-10', { category_id: 'grocery', tags: ['family'] }),
  tx('refund', 200, '2026-09-11', { category_id: 'food' }),
  tx('expense', 300, '2026-09-20', { category_id: 'transport', account_id: 'cash' }),
  tx('transfer', 1000, '2026-09-12', { account_id: 'gcash', to_account_id: 'cash' }),
  tx('expense', 999, '2026-09-21', { category_id: 'food', deleted_at: 'x' }),
  tx('expense', 1000, '2026-08-05', { category_id: 'food' }),
  tx('income', 15000, '2026-08-15', { category_id: 'salary' })
];

describe('reports', () => {
  it('overview: transfers excluded, refunds reduce expenses, compares with previous month', () => {
    const o = R.overview(txs, '2026-09-01', '2026-09-30');
    expect(o.cur.income).toBe(P(20000));
    expect(o.cur.expenses).toBe(P(2100));
    expect(o.cur.net).toBe(P(17900));
    expect(o.prevRange).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(o.change.expenses).toBe(P(1100));
    expect(o.savingsRate).toBeCloseTo(89.5);
    expect(o.highest.amount).toBe(P(1500));
  });

  it('category breakdown rolls subcategories into the parent and sums to 100%', () => {
    const rows = R.categoryBreakdown(txs, cats, '2026-09-01', '2026-09-30', 'expense');
    const food = rows.find((r) => r.category_id === 'food');
    expect(food.total).toBe(P(1800));
    expect(food.count).toBe(2);
    expect(food.largest.amount).toBe(P(1500));
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100);
    const flat = R.categoryBreakdown(txs, cats, '2026-09-01', '2026-09-30', 'expense', { rollUp: false });
    expect(flat.find((r) => r.category_id === 'grocery').total).toBe(P(1500));
  });

  it('cash flow buckets add up to the overview', () => {
    const s = R.cashflowSeries(txs, '2026-09-01', '2026-09-30', 'week');
    expect(s[0].key).toBe('2026-08-31');
    expect(s.reduce((a, b) => a + b.expenses, 0)).toBe(P(2100));
    expect(s.reduce((a, b) => a + b.income, 0)).toBe(P(20000));
    expect(R.cashflowSeries(txs, '2026-08-01', '2026-09-30', 'month').map((b) => b.net)).toEqual([P(14000), P(17900)]);
  });

  it('filters: account keeps its transfers, tag filter', () => {
    const byAcc = R.applyFilters(txs, { accountId: 'cash' });
    expect(byAcc.map((t) => t.type).sort()).toEqual(['expense', 'transfer']);
    expect(R.applyFilters(txs, { tag: '#family' })).toHaveLength(1);
  });

  it('account breakdown: opening + in − out = closing', () => {
    const accounts = [{ id: 'gcash', initial_balance: P(5000) }, { id: 'cash', initial_balance: P(1000) }];
    const rows = R.accountBreakdown(accounts, txs, '2026-09-01', '2026-09-30');
    for (const r of rows) expect(r.opening + r.moneyIn - r.moneyOut).toBe(r.closing);
    const cash = rows.find((r) => r.account.id === 'cash');
    expect(cash.moneyIn).toBe(P(1000));
    expect(cash.moneyOut).toBe(P(300));
  });

  it('previous range for custom ranges and multi-month ranges', () => {
    expect(R.previousRange('2026-09-10', '2026-09-19')).toEqual({ from: '2026-08-31', to: '2026-09-09' });
    expect(R.previousRange('2026-07-01', '2026-09-30')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('category trend over months', () => {
    const t = R.categoryTrend(txs, cats, 'food', 2, '2026-09-27');
    expect(t.map((x) => x.total)).toEqual([P(1000), P(1800)]);
  });

  it('auto grouping', () => {
    expect(R.autoUnit('2026-09-01', '2026-09-30')).toBe('day');
    expect(R.autoUnit('2026-07-01', '2026-09-30')).toBe('week');
    expect(R.autoUnit('2026-01-01', '2026-12-31')).toBe('month');
  });
});