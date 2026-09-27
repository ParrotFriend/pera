// Pure financial calculations. The transaction ledger is the ONLY source of truth:
// balances are always derived as  initial_balance + Σ(effects of live transactions).
// All numbers are integer minor units.
import { isLiabilityType } from './defaults.js';
import { addDays, endOfMonth, rangeFor, shiftMonth, startOfMonth, toLocalDate } from '../lib/dates.js';

export const TX_TYPES = ['income', 'expense', 'transfer', 'adjustment', 'refund', 'debt'];

const live = (t) => !t.deleted_at && !t.purged_at;

/** Signed effect of one transaction on one account. */
export function effectOn(tx, accountId) {
  if (!live(tx)) return 0;
  switch (tx.type) {
    case 'income':
    case 'refund':
      return tx.account_id === accountId ? tx.amount : 0;
    case 'expense':
      return tx.account_id === accountId ? -tx.amount : 0;
    case 'transfer':
      if (tx.account_id === accountId) return -tx.amount;
      if (tx.to_account_id === accountId) return tx.amount;
      return 0;
    case 'adjustment':
    case 'debt':
      return tx.account_id === accountId ? (tx.direction === 'out' ? -tx.amount : tx.amount) : 0;
    default:
      return 0;
  }
}

/** Map<accountId, balance> for every account. One pass over the ledger. */
export function computeBalances(accounts, txs) {
  const bal = new Map(accounts.map((a) => [a.id, a.initial_balance || 0]));
  for (const t of txs) {
    if (!live(t)) continue;
    const add = (id, v) => { if (bal.has(id)) bal.set(id, bal.get(id) + v); };
    switch (t.type) {
      case 'income': case 'refund': add(t.account_id, t.amount); break;
      case 'expense': add(t.account_id, -t.amount); break;
      case 'transfer': add(t.account_id, -t.amount); add(t.to_account_id, t.amount); break;
      case 'adjustment': case 'debt': add(t.account_id, t.direction === 'out' ? -t.amount : t.amount); break;
    }
  }
  return bal;
}

/**
 * Totals across accounts.
 *  cash      = money you have (asset accounts included in total)
 *  owed      = what you owe on liability accounts (positive number)
 *  netWorth  = assets − liabilities
 */
export function computeTotals(accounts, balances, debtTotals = { receivable: 0, payable: 0 }) {
  let assets = 0, liabilities = 0, cash = 0;
  for (const a of accounts) {
    if (a.deleted_at) continue;
    const b = balances.get(a.id) || 0;
    if (isLiabilityType(a.type)) {
      liabilities += -b; // liability balances are ≤ 0 when you owe
    } else {
      assets += b;
      if (a.include_in_total !== false && !a.archived_at) cash += b;
    }
  }
  // Money others owe you is still yours (an asset); what you owe is a liability.
  const receivable = debtTotals.receivable || 0, payable = debtTotals.payable || 0;
  return { assets, liabilities, cash, receivable, payable, netWorth: assets + receivable - liabilities - payable };
}

/**
 * Income/expense summary for a date range (inclusive, local dates).
 * Transfers never count as income or expense. Refunds reduce spending instead of counting as income.
 * Adjustments are reported separately (they are corrections, not earnings/spending).
 */
export function summarize(txs, { from = '0000-01-01', to = '9999-12-31', accountId = null } = {}) {
  let income = 0, spent = 0, refunds = 0, transferIn = 0, transferOut = 0, adjustIn = 0, adjustOut = 0, debtIn = 0, debtOut = 0, count = 0;
  const byCategory = new Map();
  const byIncomeCategory = new Map();
  for (const t of txs) {
    if (!live(t) || t.date < from || t.date > to) continue;
    const touches = !accountId || t.account_id === accountId || t.to_account_id === accountId;
    if (!touches) continue;
    count++;
    switch (t.type) {
      case 'income':
        income += t.amount;
        byIncomeCategory.set(t.category_id, (byIncomeCategory.get(t.category_id) || 0) + t.amount);
        break;
      case 'expense':
        spent += t.amount;
        byCategory.set(t.category_id, (byCategory.get(t.category_id) || 0) + t.amount);
        break;
      case 'refund':
        refunds += t.amount;
        if (t.category_id) byCategory.set(t.category_id, (byCategory.get(t.category_id) || 0) - t.amount);
        break;
      case 'transfer':
        if (!accountId) break; // across all accounts a transfer nets to zero
        if (t.account_id === accountId) transferOut += t.amount;
        if (t.to_account_id === accountId) transferIn += t.amount;
        break;
      case 'adjustment':
        if (t.direction === 'out') adjustOut += t.amount; else adjustIn += t.amount;
        break;
      case 'debt': // lending/borrowing/repayments move money but are never income or expense
        if (t.direction === 'out') debtOut += t.amount; else debtIn += t.amount;
        break;
    }
  }
  const expenses = spent - refunds;
  return { income, expenses, spent, refunds, net: income - expenses, transferIn, transferOut, adjustIn, adjustOut, debtIn, debtOut, count, byCategory, byIncomeCategory };
}

/** Account statement between two dates. closing = opening + all effects in range. */
export function accountStatement(account, txs, from, to) {
  let opening = account.initial_balance || 0;
  let closing = opening;
  for (const t of txs) {
    const e = effectOn(t, account.id);
    if (!e) continue;
    if (t.date < from) opening += e;
    if (t.date <= to) closing += e;
  }
  const s = summarize(txs, { from, to, accountId: account.id });
  return { opening, closing, ...s };
}

/** Daily net totals for a sparkline/bars: [{date, income, expenses}] */
export function dailySeries(txs, from, to) {
  const days = new Map();
  for (const t of txs) {
    if (!live(t) || t.date < from || t.date > to) continue;
    const d = days.get(t.date) || { date: t.date, income: 0, expenses: 0 };
    if (t.type === 'income') d.income += t.amount;
    else if (t.type === 'expense') d.expenses += t.amount;
    else if (t.type === 'refund') d.expenses -= t.amount;
    days.set(t.date, d);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}


// ============================ Budgets ============================

/** The period (inclusive local dates) that `date` falls in for this budget. */
export function budgetPeriod(budget, date = toLocalDate()) {
  if (budget.period === 'custom') return { from: budget.start_date, to: budget.end_date };
  if (budget.period === 'weekly') return rangeFor('week', date);
  return { from: startOfMonth(date), to: endOfMonth(date) };
}
function previousPeriod(budget, p) {
  if (budget.period === 'weekly') return { from: addDays(p.from, -7), to: addDays(p.from, -1) };
  const from = shiftMonth(p.from, -1);
  return { from, to: endOfMonth(from) };
}

/** Category ids covered by a budget, including subcategories of the chosen parents. */
export function budgetCategorySet(budget, categories) {
  if (budget.scope !== 'category') return null;
  const set = new Set(budget.category_ids || []);
  for (const c of categories) if (c.parent_id && set.has(c.parent_id)) set.add(c.id);
  return set;
}

/** Spending (expenses − refunds) that counts against a budget in a date range. */
export function budgetSpent(budget, txs, categories, from, to) {
  const set = budgetCategorySet(budget, categories);
  let spent = 0;
  for (const t of txs) {
    if (!live(t) || t.date < from || t.date > to) continue;
    if (t.type !== 'expense' && t.type !== 'refund') continue;
    if (set && !set.has(t.category_id)) continue;
    if (t.type === 'refund' && !t.category_id) continue;
    spent += t.type === 'expense' ? t.amount : -t.amount;
  }
  return spent;
}

/**
 * Full status of a budget for the period containing `today`.
 * Rollover: unused money from each previous period (since the budget started) carries forward.
 * Overspending is NOT carried as a penalty — each period starts at its base amount at minimum.
 */
export function budgetStatus(budget, txs, categories, today = toLocalDate()) {
  const period = budgetPeriod(budget, today);
  let carried = 0;
  if (budget.rollover && budget.period !== 'custom') {
    const chain = [];
    let p = previousPeriod(budget, period);
    const startPeriod = budgetPeriod(budget, budget.start_date);
    for (let i = 0; i < 120 && p.to >= startPeriod.from; i++) { chain.unshift(p); p = previousPeriod(budget, p); }
    for (const q of chain) {
      const available = budget.amount + carried;
      carried = Math.max(0, available - budgetSpent(budget, txs, categories, q.from, q.to));
    }
  }
  const limit = budget.amount + carried;
  const spent = budgetSpent(budget, txs, categories, period.from, period.to);
  const remaining = limit - spent;
  const pct = limit > 0 ? (spent * 100) / limit : 0;
  const alertAt = budget.alert_at || 80;
  let level = 'ok';
  if (spent > limit) level = 'exceeded';
  else if (spent === limit && limit > 0) level = 'reached';
  else if (pct >= alertAt) level = 'warning';
  return { period, limit, carried, spent, remaining, pct, level };
}

export function budgetMessage(budget, st, fmt) {
  const name = budget.name;
  switch (st.level) {
    case 'exceeded': return `Your ${name} budget has been exceeded by ${fmt(-st.remaining)}.`;
    case 'reached': return `Your ${name} budget has been reached.`;
    case 'warning': return `You're approaching your ${name} budget — ${fmt(st.remaining)} left.`;
    default: return `${fmt(st.remaining)} left to spend.`;
  }
}

// ============================ Debts (utang) ============================
/**
 * Status of one debt, derived from its payment transactions.
 * remaining = amount − Σ live payments − forgiven_amount
 */
export function debtStatus(debt, txs, today = toLocalDate()) {
  const payments = txs.filter((t) => t.debt_id === debt.id && t.debt_role === 'payment' && live(t))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const paid = payments.reduce((s, t) => s + t.amount, 0);
  const forgiven = debt.forgiven_amount || 0;
  const remaining = Math.max(0, debt.amount - paid - forgiven);
  let status;
  if (remaining === 0) status = forgiven > 0 ? 'forgiven' : 'paid';
  else if (debt.due_date && debt.due_date < today) status = 'overdue';
  else if (paid > 0) status = 'partial';
  else status = 'unpaid';
  const lastPayment = payments.at(-1)?.date || null;
  return { paid, forgiven, remaining, status, payments, lastPayment, pct: debt.amount ? Math.min(100, ((paid + forgiven) * 100) / debt.amount) : 0 };
}

/** Totals across all live debts: what others owe you and what you owe. */
export function debtTotals(debts, txs, today = toLocalDate()) {
  let receivable = 0, payable = 0, overdue = 0, people = new Set();
  for (const d of debts) {
    if (d.deleted_at) continue;
    const st = debtStatus(d, txs, today);
    if (d.direction === 'owed_to_me') { receivable += st.remaining; if (st.remaining) people.add(d.person_id); }
    else payable += st.remaining;
    if (st.status === 'overdue') overdue++;
  }
  return { receivable, payable, overdue, peopleOwing: people.size };
}
