import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db.js';
import * as L from '../src/services/ledger.js';
import * as S from '../src/services/schedules.js';
import { computeBalances, summarize } from '../src/services/calc.js';
import { createSyncEngine } from '../src/services/sync.js';
import { createFakeRemote } from './fakeRemote.js';

const P = (x) => x * 100;
let cash, gcash, food, utilities, salary, subs;
const txs = () => db.transactions.where('user_id').equals('u1').filter((t) => !t.deleted_at).toArray();
const txMap = async () => new Map((await db.transactions.toArray()).map((t) => [t.id, t]));

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  L.setActor({ userId: 'u1', device: 'test', currency: 'PHP' });
  await L.ensureDefaultCategories('u1');
  cash = await L.saveAccount({ name: 'Cash', type: 'cash', initial_balance: P(5000) });
  gcash = await L.saveAccount({ name: 'GCash', type: 'ewallet', initial_balance: P(20000) });
  const c = await db.categories.toArray();
  food = c.find((x) => x.name === 'Food'); utilities = c.find((x) => x.name === 'Utilities');
  salary = c.find((x) => x.name === 'Salary'); subs = c.find((x) => x.name === 'Subscriptions');
});

const bill = (extra = {}) => S.saveSchedule({ kind: 'bill', name: 'Internet', amount: P(1500), account_id: gcash.id, category_id: utilities.id, frequency: 'monthly', start_date: '2026-09-15', ...extra });

describe('occurrence dates', () => {
  it('monthly on the 31st uses the last day of shorter months', () => {
    const s = { frequency: 'monthly', start_date: '2026-01-31' };
    expect([0, 1, 2, 3].map((n) => S.occurrenceAt(s, n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('weekly, biweekly, quarterly, yearly, custom', () => {
    expect(S.occurrenceAt({ frequency: 'weekly', start_date: '2026-09-01' }, 2)).toBe('2026-09-15');
    expect(S.occurrenceAt({ frequency: 'biweekly', start_date: '2026-09-01' }, 1)).toBe('2026-09-15');
    expect(S.occurrenceAt({ frequency: 'quarterly', start_date: '2026-11-30' }, 1)).toBe('2027-02-28');
    expect(S.occurrenceAt({ frequency: 'yearly', start_date: '2024-02-29' }, 1)).toBe('2025-02-28');
    expect(S.occurrenceAt({ frequency: 'custom', interval: 10, interval_unit: 'day', start_date: '2026-09-01' }, 3)).toBe('2026-10-01');
  });
  it('respects end date and max count', () => {
    expect(S.occurrencesBetween({ frequency: 'monthly', start_date: '2026-01-15', end_date: '2026-03-20' }, '2026-01-01', '2026-12-31')).toHaveLength(3);
    expect(S.occurrencesBetween({ frequency: 'weekly', start_date: '2026-01-01', max_count: 4 }, '2026-01-01', '2026-12-31')).toHaveLength(4);
  });
});

describe('bills', () => {
  it('status moves upcoming → soon → today → overdue', async () => {
    const b = await bill();
    const m = await txMap();
    const st = async (today) => (await S.scheduleSummary(b, m, today)).current.state;
    expect(await st('2026-09-01')).toBe('upcoming');
    expect(await st('2026-09-10')).toBe('soon');
    expect(await st('2026-09-15')).toBe('today');
    expect(await st('2026-09-16')).toBe('overdue');
  });

  it('Bayad na creates an expense, moves to the next due date, and cannot be paid twice', async () => {
    const b = await bill();
    await S.recordOccurrence(b.id, '2026-09-15', { paid_on: '2026-09-14' });
    await S.recordOccurrence(b.id, '2026-09-15', { paid_on: '2026-09-14' });
    const list = await txs();
    const paid = list.filter((t) => t.schedule_id === b.id);
    expect(paid).toHaveLength(1);
    expect(paid[0].type).toBe('expense');
    expect(paid[0].date).toBe('2026-09-14');
    expect(summarize(list).expenses).toBe(P(1500));
    const sum = await S.scheduleSummary(b, await txMap(), '2026-09-20');
    expect(sum.current.date).toBe('2026-10-15');
  });

  it('variable amount (e.g. Meralco) requires the actual amount when paying', async () => {
    const b = await bill({ name: 'Meralco', amount: null, variable_amount: true });
    await expect(S.recordOccurrence(b.id, '2026-09-15', {})).rejects.toThrow();
    await S.recordOccurrence(b.id, '2026-09-15', { amount: P(2345) });
    expect((await txs()).find((t) => t.schedule_id === b.id).amount).toBe(P(2345));
  });

  it('skip and undo payment', async () => {
    const b = await bill();
    await S.skipOccurrence(b.id, '2026-09-15');
    let sum = await S.scheduleSummary(await db.schedules.get(b.id), await txMap(), '2026-09-20');
    expect(sum.current.date).toBe('2026-10-15');
    await S.unskipOccurrence(b.id, '2026-09-15');
    await S.recordOccurrence(b.id, '2026-09-15', {});
    await S.unpayOccurrence(b.id, '2026-09-15');
    sum = await S.scheduleSummary(await db.schedules.get(b.id), await txMap(), '2026-09-20');
    expect(sum.current.state).toBe('overdue');
    const bal = computeBalances(await db.accounts.toArray(), await txs());
    expect(bal.get(gcash.id)).toBe(P(20000));
    await S.recordOccurrence(b.id, '2026-09-15', {});
    expect((await db.transactions.toArray()).filter((t) => t.schedule_id === b.id)).toHaveLength(1);
  });

  it('bills are never auto-recorded', async () => {
    await bill({ start_date: '2026-01-15' });
    expect(await S.runSchedules('2026-09-27')).toBe(0);
  });
});

describe('recurring automation', () => {
  const salaryRule = (extra = {}) => S.saveSchedule({ kind: 'recurring', name: 'Salary', type: 'income', amount: P(20000), account_id: gcash.id, category_id: salary.id, frequency: 'monthly', start_date: '2026-07-15', auto: true, ...extra });

  it('catches up missed months exactly once, even if run many times', async () => {
    await salaryRule();
    await S.runSchedules('2026-09-27');
    await S.runSchedules('2026-09-27');
    await Promise.all([S.runSchedules('2026-09-27'), S.runSchedules('2026-09-27')]);
    const list = (await txs()).filter((t) => t.type === 'income');
    expect(list.map((t) => t.date).sort()).toEqual(['2026-07-15', '2026-08-15', '2026-09-15']);
  });

  it('a deleted auto transaction is not re-created', async () => {
    const s = await salaryRule();
    await S.runSchedules('2026-09-27');
    const aug = (await txs()).find((t) => t.date === '2026-08-15');
    await L.deleteTransaction(aug.id);
    await S.runSchedules('2026-09-27');
    expect((await txs()).filter((t) => t.schedule_id === s.id)).toHaveLength(2);
  });

  it('pause skips the paused period; resume continues', async () => {
    const s = await salaryRule({ start_date: '2030-01-01', frequency: 'weekly' });
    await S.runSchedules('2030-01-01');
    await S.setPaused(s.id, true);
    await db.schedules.update(s.id, { paused_at: '2030-01-02T00:00:00.000Z' });
    await S.runSchedules('2030-01-20');
    expect((await txs()).filter((t) => t.schedule_id === s.id)).toHaveLength(1);
    await S.setPaused(s.id, false, '2030-01-20');
    expect((await txs()).filter((t) => t.schedule_id === s.id)).toHaveLength(1);
    await S.runSchedules('2030-01-22');
    expect((await txs()).filter((t) => t.schedule_id === s.id).map((t) => t.date).sort()).toEqual(['2030-01-01', '2030-01-22']);
  });

  it('ask-first recurring waits for confirmation', async () => {
    const s = await S.saveSchedule({ kind: 'recurring', name: 'Netflix', type: 'expense', amount: P(549), account_id: gcash.id, category_id: subs.id, frequency: 'monthly', start_date: '2026-09-20', auto: false });
    expect(await S.runSchedules('2026-09-27')).toBe(0);
    const sum = await S.scheduleSummary(s, await txMap(), '2026-09-27');
    expect(sum.current.state).toBe('overdue');
    await S.recordOccurrence(s.id, '2026-09-20', {});
    expect((await txs()).filter((t) => t.schedule_id === s.id)).toHaveLength(1);
  });

  it('recurring transfer (savings) moves money, not income/expense', async () => {
    await S.saveSchedule({ kind: 'recurring', name: 'Ipon', type: 'transfer', amount: P(2000), account_id: gcash.id, to_account_id: cash.id, frequency: 'monthly', start_date: '2026-09-01', auto: true });
    await S.runSchedules('2026-09-27');
    const list = await txs();
    const bal = computeBalances(await db.accounts.toArray(), list);
    expect(bal.get(cash.id)).toBe(P(7000));
    expect(summarize(list).income).toBe(0);
    expect(summarize(list).expenses).toBe(0);
  });

  it('changing the timing does not rewrite history', async () => {
    const s = await salaryRule();
    await S.runSchedules(new Date().toISOString().slice(0, 10) < '2026-09-27' ? '2026-09-27' : undefined);
    const before = (await txs()).filter((t) => t.schedule_id === s.id).length;
    await S.saveSchedule({ kind: 'recurring', name: 'Salary', type: 'income', amount: P(25000), account_id: gcash.id, category_id: salary.id, frequency: 'monthly', start_date: '2026-07-30', auto: true }, s.id);
    const saved = await db.schedules.get(s.id);
    expect(saved.effective_from).toBeTruthy();
    const after = (await txs()).filter((t) => t.schedule_id === s.id && t.occurrence_date < saved.effective_from);
    expect(after.length).toBe(before);
    expect(after.every((t) => t.amount === P(20000))).toBe(true);
  });

  it('validation', async () => {
    await expect(S.saveSchedule({ kind: 'bill', name: '', amount: P(1), account_id: gcash.id, category_id: utilities.id, frequency: 'monthly', start_date: '2026-09-01' })).rejects.toThrow();
    await expect(S.saveSchedule({ kind: 'recurring', name: 'x', type: 'income', amount: P(1), account_id: gcash.id, category_id: food.id, frequency: 'monthly', start_date: '2026-09-01' })).rejects.toThrow();
  });

  it('two devices recording the same occurrence sync as one', async () => {
    const remote = createFakeRemote();
    const engine = createSyncEngine({ remote, getUserId: () => 'u1', isOnline: () => true });
    const s = await salaryRule({ start_date: '2026-09-15' });
    await S.runSchedules('2026-09-27');
    await engine.sync();
    const t = (await txs()).find((x) => x.schedule_id === s.id);
    await db.transactions.put({ ...t, version: 0, sync_status: 'pending' });
    await db.outbox.add({ key: `transactions:${t.id}`, table: 'transactions', record_id: t.id, user_id: 'u1', attempts: 0, next_attempt_at: 0 });
    await engine.sync();
    expect([...remote.tables.transactions.values()].filter((x) => x.schedule_id === s.id)).toHaveLength(1);
    expect(engine.getState().conflicts).toBe(0);
    expect(remote.tables.schedules.size).toBe(1);
  });
});