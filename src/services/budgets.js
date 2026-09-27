// Budgets: create/edit/archive/delete + alert check after a new expense.
import { db } from '../db/db.js';
import { nowIso } from '../lib/id.js';
import { isValidLocalDate, toLocalDate } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';
import { RW, ValidationError, getActor, newBase, notify, requireUser, writeLocal } from './ledger.js';
import { budgetStatus, budgetCategorySet } from './calc.js';

export function validateBudget(b) {
  const f = {};
  if (!b.name?.trim()) f.name = 'Give this budget a name.';
  if (!Number.isSafeInteger(b.amount) || b.amount <= 0) f.amount = 'Enter an amount greater than zero.';
  if (!['overall', 'category'].includes(b.scope)) f.scope = 'Choose what this budget covers.';
  if (b.scope === 'category' && !(b.category_ids || []).length) f.category_ids = 'Pick at least one category.';
  if (!['monthly', 'weekly', 'custom'].includes(b.period)) f.period = 'Choose a period.';
  if (b.period === 'custom') {
    if (!isValidLocalDate(b.start_date)) f.start_date = 'Enter a start date.';
    if (!isValidLocalDate(b.end_date)) f.end_date = 'Enter an end date.';
    else if (b.start_date && b.end_date < b.start_date) f.end_date = 'End date must be after the start date.';
  }
  const a = Number(b.alert_at);
  if (!Number.isInteger(a) || a < 1 || a > 100) f.alert_at = 'Use a number from 1 to 100.';
  if (Object.keys(f).length) throw new ValidationError(f);
}

export async function saveBudget(input, id = null) {
  const userId = requireUser();
  validateBudget(input);
  const clean = {
    name: input.name.trim(), scope: input.scope, category_ids: input.scope === 'category' ? [...new Set(input.category_ids)] : [],
    amount: input.amount, period: input.period,
    start_date: input.period === 'custom' ? input.start_date : input.start_date || toLocalDate(),
    end_date: input.period === 'custom' ? input.end_date : null,
    rollover: input.period === 'custom' ? false : !!input.rollover, alert_at: Number(input.alert_at) || 80
  };
  let saved;
  await db.transaction('rw', RW, async () => {
    if (id) {
      const cur = await db.budgets.get(id);
      if (!cur || cur.user_id !== userId) throw new Error('Budget not found');
      saved = await writeLocal('budgets', { ...cur, ...clean, start_date: cur.start_date }, 'updated', `Updated budget ${clean.name} (${formatMoney(clean.amount, getActor().currency)} ${clean.period})`);
    } else {
      saved = await writeLocal('budgets', { ...newBase(userId), ...clean, archived_at: null }, 'created', `Created budget ${clean.name}: ${formatMoney(clean.amount, getActor().currency)} ${clean.period}`);
    }
  });
  notify();
  return saved;
}

export async function deleteBudget(id) {
  await db.transaction('rw', RW, async () => {
    const cur = await db.budgets.get(id);
    await writeLocal('budgets', { ...cur, deleted_at: nowIso() }, 'deleted', `Deleted budget ${cur.name}`);
  });
  notify();
}

/**
 * After saving an expense: return alert messages for budgets this expense pushed across a threshold.
 * Only reports a crossing (before < level ≤ after), so the user isn't nagged on every expense.
 */
export async function budgetAlertsFor(tx) {
  if (tx.type !== 'expense') return [];
  const userId = requireUser();
  const [budgets, categories, txs] = await Promise.all([
    db.budgets.where('user_id').equals(userId).filter((b) => !b.deleted_at && !b.archived_at).toArray(),
    db.categories.where('user_id').equals(userId).toArray(),
    db.transactions.where('user_id').equals(userId).filter((t) => !t.deleted_at && !t.purged_at).toArray()
  ]);
  const rank = { ok: 0, warning: 1, reached: 2, exceeded: 3 };
  const out = [];
  for (const b of budgets) {
    const set = budgetCategorySet(b, categories);
    if (set && !set.has(tx.category_id)) continue;
    const after = budgetStatus(b, txs, categories, tx.date);
    if (tx.date < after.period.from || tx.date > after.period.to) continue;
    const before = budgetStatus(b, txs.filter((t) => t.id !== tx.id), categories, tx.date);
    if (rank[after.level] > rank[before.level]) out.push({ budget: b, status: after });
  }
  return out;
}
