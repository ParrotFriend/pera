// Utang: money you lent (owed_to_me) or borrowed (i_owe), with partial payments.
// Lending/borrowing and repayments are 'debt' transactions: they move money between your
// accounts and the debt, and are never counted as income or expense.
import { db } from '../db/db.js';
import { nowIso } from '../lib/id.js';
import { isValidLocalDate, toLocalDate, toLocalTime } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';
import { RW, ValidationError, getActor, newBase, notify, requireUser, writeLocal, stableId } from './ledger.js';
import { debtStatus } from './calc.js';

const cur = () => getActor().currency;
const personKey = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function findOrCreatePerson(userId, name, phone) {
  const key = personKey(name);
  const existing = await db.people.where('user_id').equals(userId).filter((p) => !p.deleted_at && personKey(p.name) === key).first();
  if (existing) {
    if (phone && phone !== existing.phone) return writeLocal('people', { ...existing, phone }, 'updated', null);
    return existing;
  }
  return writeLocal('people', { ...newBase(userId), name: name.trim(), phone: phone || null, notes: '' }, 'created', `Added ${name.trim()} to Utang contacts`);
}

async function checkAccount(userId, id, f, field = 'account_id') {
  if (!id) { f[field] = 'Choose an account.'; return null; }
  const a = await db.accounts.get(id);
  if (!a || a.user_id !== userId || a.deleted_at) f[field] = 'Choose an account.';
  else if (a.archived_at) f[field] = 'This account is archived.';
  return a;
}

/**
 * Create or edit a debt. When `account_id` is set, the money actually moved on `date`, so a
 * principal transaction is kept in sync with the debt (lend = money out, borrow = money in).
 * `account_id = null` means an old debt from before using the app: no account changes.
 */
export async function saveDebt(input, id = null) {
  const userId = requireUser();
  const f = {};
  if (!input.person_name?.trim()) f.person_name = 'Who is this with?';
  if (input.account_id === undefined) f.account_id = 'Choose an account or “Dating utang”.';
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) f.amount = 'Enter an amount greater than zero.';
  if (!isValidLocalDate(input.date)) f.date = 'Enter a valid date.';
  if (input.due_date && !isValidLocalDate(input.due_date)) f.due_date = 'Enter a valid date.';
  else if (input.due_date && input.due_date < input.date) f.due_date = 'Due date can’t be before the loan date.';
  if (!['owed_to_me', 'i_owe'].includes(input.direction)) f.direction = 'Choose a direction.';
  if (input.account_id) await checkAccount(userId, input.account_id, f);
  if (id) {
    const d = await db.debts.get(id);
    const txs = await db.transactions.where('[user_id+debt_id]').equals([userId, id]).toArray();
    const st = debtStatus(d, txs);
    if (Number.isSafeInteger(input.amount) && input.amount < st.paid + st.forgiven) f.amount = `Can’t be less than what’s already paid (${formatMoney(st.paid + st.forgiven, cur())}).`;
  }
  if (Object.keys(f).length) throw new ValidationError(f);

  let saved;
  await db.transaction('rw', RW, async () => {
    const person = await findOrCreatePerson(userId, input.person_name, input.phone?.trim() || null);
    const clean = {
      person_id: person.id, direction: input.direction, amount: input.amount, date: input.date,
      due_date: input.due_date || null, account_id: input.account_id || null, notes: (input.notes || '').trim()
    };
    const lent = clean.direction === 'owed_to_me';
    const label = `${lent ? 'Lent' : 'Borrowed'} ${formatMoney(clean.amount, cur())} ${lent ? 'to' : 'from'} ${person.name}`;
    if (id) {
      const prev = await db.debts.get(id);
      if (!prev || prev.user_id !== userId) throw new Error('Not found');
      saved = await writeLocal('debts', { ...prev, ...clean }, 'updated', `Edited: ${label}`);
    } else {
      saved = await writeLocal('debts', { ...newBase(userId), ...clean, forgiven_amount: 0, forgiven_at: null }, 'created', label);
    }
    // Keep the principal transaction consistent with the debt.
    const principal = await db.transactions.where('[user_id+debt_id]').equals([userId, saved.id]).filter((t) => t.debt_role === 'principal' && !t.purged_at).first();
    if (clean.account_id) {
      const tx = {
        type: 'debt', debt_id: saved.id, debt_role: 'principal', direction: lent ? 'out' : 'in', amount: clean.amount,
        account_id: clean.account_id, to_account_id: null, category_id: null, refund_of: null,
        date: clean.date, time: principal?.time || toLocalTime(), payee: person.name, payee_key: personKey(person.name),
        notes: clean.notes, tags: [], deleted_at: null
      };
      if (principal) await writeLocal('transactions', { ...principal, ...tx }, null, null);
      else await writeLocal('transactions', { ...newBase(userId), ...tx, created_by: userId, purged_at: null }, null, null);
    } else if (principal && !principal.deleted_at) {
      await writeLocal('transactions', { ...principal, deleted_at: nowIso() }, null, null); // switched to "old debt"
    }
  });
  notify();
  return saved;
}

/**
 * Record a (partial) payment. If more than the remaining balance is paid, the extra is saved as a
 * separate income (for money owed to you) or expense (for your own debt) labelled as interest/extra.
 */
export async function recordPayment(debtId, { amount, account_id, date = toLocalDate(), time = toLocalTime(), notes = '', extra = 'interest' }) {
  const userId = requireUser();
  const f = {};
  if (!Number.isSafeInteger(amount) || amount <= 0) f.amount = 'Enter an amount greater than zero.';
  if (!isValidLocalDate(date)) f.date = 'Enter a valid date.';
  await checkAccount(userId, account_id, f);
  const debt = await db.debts.get(debtId);
  if (!debt || debt.user_id !== userId || debt.deleted_at) throw new Error('Not found');
  const txs = await db.transactions.where('[user_id+debt_id]').equals([userId, debtId]).toArray();
  const st = debtStatus(debt, txs);
  if (st.remaining === 0) f.amount = 'This is already fully settled.';
  if (Object.keys(f).length) throw new ValidationError(f);

  const person = await db.people.get(debt.person_id);
  const toMe = debt.direction === 'owed_to_me';
  const applied = Math.min(amount, st.remaining);
  const excess = amount - applied;
  let result;
  await db.transaction('rw', RW, async () => {
    const base = { account_id, to_account_id: null, refund_of: null, date, time, payee: person?.name || '', payee_key: personKey(person?.name), tags: [], purged_at: null };
    result = await writeLocal('transactions', {
      ...newBase(userId), ...base, type: 'debt', debt_id: debtId, debt_role: 'payment', direction: toMe ? 'in' : 'out',
      amount: applied, category_id: null, notes: notes || '', created_by: userId
    }, 'created', `${toMe ? `${person?.name} paid` : `Paid ${person?.name}`} ${formatMoney(applied, cur())}${applied < st.remaining ? ` (${formatMoney(st.remaining - applied, cur())} left)` : ' — fully paid'}`);
    if (excess > 0) {
      const kind = toMe ? 'income' : 'expense';
      const category = await ensureCategory(userId, kind, toMe ? 'Interest' : 'Loan interest', 'percent', '#3B7DD8');
      await writeLocal('transactions', {
        ...newBase(userId), ...base, type: kind, debt_id: null, debt_role: null, direction: null, amount: excess,
        category_id: category.id, notes: `Extra over the ${toMe ? 'loan' : 'debt'} amount${extra ? ` (${extra})` : ''}`, created_by: userId
      }, 'created', `${toMe ? 'Extra received from' : 'Extra paid to'} ${person?.name}: ${formatMoney(excess, cur())} recorded as ${kind}`);
    }
  });
  notify();
  return { payment: result, applied, excess };
}

async function ensureCategory(userId, kind, name, icon, color) {
  const found = await db.categories.where('[user_id+kind]').equals([userId, kind]).filter((c) => !c.deleted_at && c.name === name && !c.parent_id).first();
  if (found) { if (found.archived_at) await writeLocal('categories', { ...found, archived_at: null }, null, null); return found; }
  const id = await stableId(`${userId}:${kind}:${name}`);
  const existing = await db.categories.get(id);
  if (existing) return writeLocal('categories', { ...existing, deleted_at: null, archived_at: null }, null, null);
  return writeLocal('categories', { ...newBase(userId), id, kind, name, parent_id: null, icon, color, archived_at: null }, 'created', `Created category ${name}`);
}

/** Stop collecting / lender cancelled it. No account changes — only the remaining balance is cleared. */
export async function forgiveDebt(debtId) {
  const userId = requireUser();
  await db.transaction('rw', RW, async () => {
    const d = await db.debts.get(debtId);
    const txs = await db.transactions.where('[user_id+debt_id]').equals([userId, debtId]).toArray();
    const st = debtStatus(d, txs);
    if (!st.remaining) return;
    const person = await db.people.get(d.person_id);
    await writeLocal('debts', { ...d, forgiven_amount: (d.forgiven_amount || 0) + st.remaining, forgiven_at: nowIso() }, 'updated',
      `${d.direction === 'owed_to_me' ? `Stopped collecting from ${person?.name}` : `${person?.name} cancelled the debt`}: ${formatMoney(st.remaining, cur())}`);
  });
  notify();
}

export async function undoForgive(debtId) {
  await db.transaction('rw', RW, async () => {
    const d = await db.debts.get(debtId);
    await writeLocal('debts', { ...d, forgiven_amount: 0, forgiven_at: null }, 'restored', 'Resumed collecting the remaining balance');
  });
  notify();
}

/** Undo one payment (moves it to Trash; the balance goes back). */
export async function deletePayment(txId) {
  await db.transaction('rw', RW, async () => {
    const t = await db.transactions.get(txId);
    await writeLocal('transactions', { ...t, deleted_at: nowIso() }, 'deleted', `Removed payment of ${formatMoney(t.amount, cur())} (${t.payee})`);
  });
  notify();
}

/** Delete a debt together with all its money movements (restorable from Trash). */
export async function deleteDebt(debtId) {
  const userId = requireUser();
  const ts = nowIso();
  await db.transaction('rw', RW, async () => {
    const d = await db.debts.get(debtId);
    const person = await db.people.get(d.person_id);
    await writeLocal('debts', { ...d, deleted_at: ts }, 'deleted', `Moved to Trash: ${d.direction === 'owed_to_me' ? 'loan to' : 'debt to'} ${person?.name} (${formatMoney(d.amount, cur())})`);
    const txs = await db.transactions.where('[user_id+debt_id]').equals([userId, debtId]).filter((t) => !t.deleted_at && !t.purged_at).toArray();
    for (const t of txs) await writeLocal('transactions', { ...t, deleted_at: ts, trashed_with: debtId }, null, null);
  });
  notify();
}

export async function restoreDebt(debtId) {
  const userId = requireUser();
  await db.transaction('rw', RW, async () => {
    const d = await db.debts.get(debtId);
    await writeLocal('debts', { ...d, deleted_at: null }, 'restored', 'Restored a debt from Trash');
    const txs = await db.transactions.where('[user_id+debt_id]').equals([userId, debtId]).filter((t) => t.deleted_at === d.deleted_at && !t.purged_at).toArray();
    for (const t of txs) await writeLocal('transactions', { ...t, deleted_at: null, trashed_with: null }, null, null);
  });
  notify();
}

/** Friendly reminder text the user can send themselves (never sent automatically). */
export function reminderText(person, debt, st, currency) {
  const due = debt.due_date ? `, due ${new Date(debt.due_date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
  return `Hi ${person.name}! Paalala lang po sa utang na ${formatMoney(st.remaining, currency)} na natitira${due}. Salamat po!`;
}
