// Report calculations (pure functions, no database access).
// All amounts are integer minor units. Transfers never count as income or expense.
import { summarize, accountStatement } from './calc.js';
import { addDays, parseLocalDate, toLocalDate, startOfMonth, endOfMonth, shiftMonth } from '../lib/dates.js';

const live = (t) => !t.deleted_at && !t.purged_at;
const pad = (n) => String(n).padStart(2, '0');
const dayCount = (from, to) => Math.round((parseLocalDate(to) - parseLocalDate(from)) / 86400000) + 1;

/** Pick a sensible grouping for a date range. */
export function autoUnit(from, to) {
  const days = dayCount(from, to);
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

/** Start of the bucket (day / Monday-week / month) that contains `date`. */
export function bucketKey(date, unit) {
  if (unit === 'day') return date;
  if (unit === 'month') return date.slice(0, 8) + '01';
  const d = parseLocalDate(date);
  return addDays(date, -((d.getDay() + 6) % 7));
}

/** Every bucket between from and to, in order: [{ key, from, to, label }]. */
export function buckets(from, to, unit) {
  const out = [];
  let key = bucketKey(from, unit);
  for (let i = 0; i < 1000 && key <= to; i++) {
    const end = unit === 'day' ? key : unit === 'week' ? addDays(key, 6) : endOfMonth(key);
    const d = parseLocalDate(key);
    const label = unit === 'month'
      ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      : unit === 'day' && d.getDate() !== 1 && i > 0 ? String(d.getDate())
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    out.push({ key, from: key < from ? from : key, to: end > to ? to : end, label });
    key = unit === 'day' ? addDays(key, 1) : unit === 'week' ? addDays(key, 7) : shiftMonth(key, 1);
  }
  return out;
}

/** Keep only transactions that match the report filters. Account filtering keeps transfers touching it. */
export function applyFilters(txs, { accountId = null, tag = '' } = {}) {
  const t = tag.trim().replace(/^#/, '').toLowerCase();
  return txs.filter((x) => live(x)
    && (!accountId || x.account_id === accountId || x.to_account_id === accountId)
    && (!t || (x.tags || []).includes(t)));
}

/** Income / expenses / net per bucket. */
export function cashflowSeries(txs, from, to, unit, accountId = null) {
  const list = buckets(from, to, unit).map((b) => ({ ...b, income: 0, expenses: 0 }));
  const index = new Map(list.map((b, i) => [b.key, i]));
  for (const t of txs) {
    if (!live(t) || t.date < from || t.date > to) continue;
    if (accountId && t.account_id !== accountId && t.to_account_id !== accountId) continue;
    const b = list[index.get(bucketKey(t.date, unit))];
    if (!b) continue;
    if (t.type === 'income') b.income += t.amount;
    else if (t.type === 'expense') b.expenses += t.amount;
    else if (t.type === 'refund') b.expenses -= t.amount;
  }
  return list.map((b) => ({ ...b, net: b.income - b.expenses }));
}

/**
 * Totals per category for expenses (after refunds) or income.
 * Subcategories roll up into their parent when `rollUp` is true.
 */
export function categoryBreakdown(txs, categories, from, to, kind = 'expense', { rollUp = true } = {}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const top = (id) => (rollUp && byId.get(id)?.parent_id ? byId.get(id).parent_id : id) || null;
  const rows = new Map();
  let total = 0;
  for (const t of txs) {
    if (!live(t) || t.date < from || t.date > to) continue;
    let sign = 0;
    if (kind === 'expense') sign = t.type === 'expense' ? 1 : t.type === 'refund' && t.category_id ? -1 : 0;
    else sign = t.type === 'income' ? 1 : 0;
    if (!sign) continue;
    const id = top(t.category_id);
    const r = rows.get(id) || { category_id: id, total: 0, count: 0, largest: null };
    r.total += sign * t.amount;
    if (sign > 0) { r.count++; if (!r.largest || t.amount > r.largest.amount) r.largest = t; }
    rows.set(id, r);
    total += sign * t.amount;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, avg: r.count ? Math.round(r.total / r.count) : 0, pct: total > 0 ? (r.total * 100) / total : 0 }))
    .filter((r) => r.total !== 0)
    .sort((a, b) => b.total - a.total);
}

/** Opening, money in, money out and closing per account for the range. */
export function accountBreakdown(accounts, txs, from, to) {
  return accounts.map((a) => {
    const mine = txs.filter((t) => t.account_id === a.id || t.to_account_id === a.id);
    const st = accountStatement(a, mine, from, to);
    const moneyIn = st.income + st.refunds + st.transferIn + st.adjustIn + st.debtIn;
    const moneyOut = st.spent + st.transferOut + st.adjustOut + st.debtOut;
    return { account: a, opening: st.opening, closing: st.closing, moneyIn, moneyOut, count: st.count };
  }).filter((r) => r.count > 0 || r.opening !== 0 || r.closing !== 0);
}

/** The range right before [from, to]. Whole months compare with the previous whole month(s). */
export function previousRange(from, to) {
  const wholeMonths = from === startOfMonth(from) && to === endOfMonth(to);
  if (wholeMonths) {
    const months = (parseLocalDate(to).getFullYear() - parseLocalDate(from).getFullYear()) * 12 + parseLocalDate(to).getMonth() - parseLocalDate(from).getMonth() + 1;
    const pFrom = shiftMonth(from, -months);
    return { from: pFrom, to: endOfMonth(shiftMonth(pFrom, months - 1)) };
  }
  const days = dayCount(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** Headline numbers + comparison with the previous range. */
export function overview(txs, from, to, accountId = null) {
  const cur = summarize(txs, { from, to, accountId });
  const p = previousRange(from, to);
  const prev = summarize(txs, { from: p.from, to: p.to, accountId });
  const rate = (s) => (s.income > 0 ? (Math.max(0, s.net) * 100) / s.income : null);
  let highest = null;
  for (const t of txs) {
    if (live(t) && t.type === 'expense' && t.date >= from && t.date <= to && (!accountId || t.account_id === accountId) && (!highest || t.amount > highest.amount)) highest = t;
  }
  return {
    cur, prev, prevRange: p, highest,
    savingsRate: rate(cur), prevSavingsRate: rate(prev),
    change: {
      income: cur.income - prev.income,
      expenses: cur.expenses - prev.expenses,
      net: cur.net - prev.net
    }
  };
}

/** Monthly totals of one category for the last `months` months (category analytics). */
export function categoryTrend(txs, categories, categoryId, months = 6, today = toLocalDate()) {
  const ids = new Set([categoryId, ...categories.filter((c) => c.parent_id === categoryId).map((c) => c.id)]);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const from = shiftMonth(today, -i);
    const to = endOfMonth(from);
    let total = 0;
    for (const t of txs) {
      if (!live(t) || t.date < from || t.date > to || !ids.has(t.category_id)) continue;
      if (t.type === 'expense' || t.type === 'income') total += t.amount;
      else if (t.type === 'refund') total -= t.amount;
    }
    out.push({ from, label: parseLocalDate(from).toLocaleDateString(undefined, { month: 'short' }), total });
  }
  return out;
}

/** CSV text for a report (category table + cash flow), with formula-injection protection. */
export function reportCsv({ title, from, to, cash, expenseRows, incomeRows, catLabel, fmt }) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [[title], [`${from} to ${to}`], [], ['Period', 'Income', 'Expenses', 'Net']];
  for (const b of cash) lines.push([b.key, fmt(b.income), fmt(b.expenses), fmt(b.net)]);
  lines.push([], ['Expense category', 'Total', '% of expenses', 'Transactions', 'Average', 'Largest']);
  for (const r of expenseRows) lines.push([catLabel(r.category_id), fmt(r.total), r.pct.toFixed(1), r.count, fmt(r.avg), r.largest ? fmt(r.largest.amount) : '']);
  lines.push([], ['Income category', 'Total', '% of income', 'Transactions']);
  for (const r of incomeRows) lines.push([catLabel(r.category_id), fmt(r.total), r.pct.toFixed(1), r.count]);
  return '\uFEFF' + lines.map((l) => l.map(cell).join(',')).join('\r\n');
}

export { pad };