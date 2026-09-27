// Pure financial calculations. The transaction ledger is the ONLY source of truth:
// balances are always derived as  initial_balance + Σ(effects of live transactions).
// All numbers are integer minor units.
import { isLiabilityType } from './defaults.js';

export const TX_TYPES = ['income', 'expense', 'transfer', 'adjustment', 'refund'];

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
      case 'adjustment': add(t.account_id, t.direction === 'out' ? -t.amount : t.amount); break;
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
export function computeTotals(accounts, balances) {
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
  return { assets, liabilities, cash, netWorth: assets - liabilities };
}

/**
 * Income/expense summary for a date range (inclusive, local dates).
 * Transfers never count as income or expense. Refunds reduce spending instead of counting as income.
 * Adjustments are reported separately (they are corrections, not earnings/spending).
 */
export function summarize(txs, { from = '0000-01-01', to = '9999-12-31', accountId = null } = {}) {
  let income = 0, spent = 0, refunds = 0, transferIn = 0, transferOut = 0, adjustIn = 0, adjustOut = 0, count = 0;
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
    }
  }
  const expenses = spent - refunds;
  return { income, expenses, spent, refunds, net: income - expenses, transferIn, transferOut, adjustIn, adjustOut, count, byCategory, byIncomeCategory };
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
