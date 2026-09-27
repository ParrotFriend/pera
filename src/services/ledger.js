// Ledger service: every write goes through here.
// Each write is ONE IndexedDB transaction that updates the record, marks it dirty in the
// outbox (sync queue) and appends an audit entry — all or nothing.
import { db, getMeta, setMeta } from '../db/db.js';
import { uuid, nowIso } from '../lib/id.js';
import { isValidLocalDate, toLocalDate, toLocalTime } from '../lib/dates.js';
import { computeBalances } from './calc.js';
import { DEFAULT_CATEGORIES, PAYEE_HINTS, ACCOUNT_TYPES, isLiabilityType } from './defaults.js';
import { formatMoney } from '../lib/money.js';

// ---- actor / change notification -------------------------------------------------------
const actor = { userId: null, device: 'this device', currency: 'PHP' };
const listeners = new Set();
export function setActor(a) { Object.assign(actor, a); }
export function getActor() { return { ...actor }; }
export function onLocalChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

export class ValidationError extends Error {
  constructor(fields) { super('Please fix the highlighted fields.'); this.fields = fields; }
}

export function requireUser() {
  if (!actor.userId) throw new Error('No active user');
  return actor.userId;
}

async function markDirty(table, id, userId) {
  const key = `${table}:${id}`;
  const existing = await db.outbox.where('key').equals(key).first();
  if (existing) await db.outbox.update(existing.seq, { attempts: 0, next_attempt_at: 0, last_error: null });
  else await db.outbox.add({ key, table, record_id: id, user_id: userId, attempts: 0, next_attempt_at: 0, last_error: null });
}

async function audit(userId, entity, entityId, action, summary) {
  const ts = nowIso();
  const row = { id: uuid(), user_id: userId, entity, entity_id: entityId, action, summary, device: actor.device, at: ts, created_at: ts, updated_at: ts, deleted_at: null, version: 0, sync_status: 'pending' };
  await db.audit_logs.add(row);
  await markDirty('audit_logs', row.id, userId);
}

/** Put a record as a local change: pending sync + outbox + audit. Must run inside a db.transaction. */
export async function writeLocal(table, record, action, summary) {
  const userId = record.user_id;
  const stamped = { ...record, updated_at: nowIso(), sync_status: 'pending' };
  await db[table].put(stamped);
  await markDirty(table, stamped.id, userId);
  if (summary) await audit(userId, table, stamped.id, action, summary);
  return stamped;
}

export const RW = ['accounts', 'categories', 'transactions', 'audit_logs', 'outbox', 'budgets', 'people', 'debts'];
export const newBase = (userId) => { const ts = nowIso(); return { id: uuid(), user_id: userId, created_at: ts, updated_at: ts, deleted_at: null, version: 0 }; };

// ---- deterministic ids for default categories (no duplicates across devices) --------------
export async function stableId(seed) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  const h = [...new Uint8Array(buf)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function ensureDefaultCategories(userId = requireUser()) {
  const count = await db.categories.where('user_id').equals(userId).count();
  if (count > 0) return;
  const rows = [];
  for (const kind of ['expense', 'income']) {
    for (const [name, icon, color] of DEFAULT_CATEGORIES[kind]) {
      rows.push({ ...newBase(userId), id: await stableId(`${userId}:${kind}:${name}`), kind, name, parent_id: null, icon, color, archived_at: null });
    }
  }
  await db.transaction('rw', RW, async () => {
    for (const r of rows) {
      if (await db.categories.get(r.id)) continue; // already pulled from server
      await writeLocal('categories', r, 'created', null);
    }
  });
  notify();
}

// ---- accounts -------------------------------------------------------------------------------
export function validateAccount(input) {
  const f = {};
  if (!input.name?.trim()) f.name = 'Give this account a name.';
  else if (input.name.trim().length > 60) f.name = 'Keep the name under 60 characters.';
  if (!ACCOUNT_TYPES.some((t) => t.value === input.type)) f.type = 'Choose an account type.';
  if (!Number.isSafeInteger(input.initial_balance)) f.initial_balance = 'Enter a valid amount.';
  if (input.low_balance_threshold != null && (!Number.isSafeInteger(input.low_balance_threshold) || input.low_balance_threshold < 0)) f.low_balance_threshold = 'Enter a valid amount.';
  if (Object.keys(f).length) throw new ValidationError(f);
}

export async function saveAccount(input, id = null) {
  const userId = requireUser();
  validateAccount(input);
  const clean = {
    name: input.name.trim(), type: input.type, initial_balance: input.initial_balance,
    currency: input.currency || actor.currency, description: input.description?.trim() || '',
    icon: input.icon || ACCOUNT_TYPES.find((t) => t.value === input.type)?.icon || 'wallet',
    color: input.color || '#141B3C', low_balance_threshold: input.low_balance_threshold ?? null,
    include_in_total: input.include_in_total !== false
  };
  let saved;
  await db.transaction('rw', RW, async () => {
    if (id) {
      const cur = await db.accounts.get(id);
      if (!cur || cur.user_id !== userId) throw new Error('Account not found');
      const changes = [];
      if (cur.initial_balance !== clean.initial_balance) changes.push(`starting balance ${formatMoney(cur.initial_balance, cur.currency)} → ${formatMoney(clean.initial_balance, clean.currency)}`);
      if (cur.name !== clean.name) changes.push(`renamed "${cur.name}" → "${clean.name}"`);
      saved = await writeLocal('accounts', { ...cur, ...clean }, 'updated', `Updated account ${clean.name}${changes.length ? ': ' + changes.join(', ') : ''}`);
    } else {
      const count = await db.accounts.where('user_id').equals(userId).count();
      saved = await writeLocal('accounts', { ...newBase(userId), ...clean, sort_order: count, archived_at: null }, 'created', `Created account ${clean.name} with ${formatMoney(clean.initial_balance, clean.currency)}`);
    }
  });
  notify();
  return saved;
}

async function accountHasTransactions(userId, id) {
  const a = await db.transactions.where('[user_id+account_id]').equals([userId, id]).filter((t) => !t.purged_at).count();
  const b = await db.transactions.where('[user_id+to_account_id]').equals([userId, id]).filter((t) => !t.purged_at).count();
  return a + b > 0;
}

export async function setAccountArchived(id, archived) {
  const userId = requireUser();
  await db.transaction('rw', RW, async () => {
    const cur = await db.accounts.get(id);
    if (!cur || cur.user_id !== userId) throw new Error('Account not found');
    await writeLocal('accounts', { ...cur, archived_at: archived ? nowIso() : null }, archived ? 'archived' : 'restored', `${archived ? 'Archived' : 'Unarchived'} account ${cur.name}`);
  });
  notify();
}

/** Accounts with history are archived (never destroyed). Empty accounts go to Trash. */
export async function removeAccount(id) {
  const userId = requireUser();
  if (await accountHasTransactions(userId, id)) {
    await setAccountArchived(id, true);
    return 'archived';
  }
  await db.transaction('rw', RW, async () => {
    const cur = await db.accounts.get(id);
    await writeLocal('accounts', { ...cur, deleted_at: nowIso() }, 'deleted', `Moved account ${cur.name} to Trash`);
  });
  notify();
  return 'trashed';
}

export async function restoreAccount(id) {
  await db.transaction('rw', RW, async () => {
    const cur = await db.accounts.get(id);
    await writeLocal('accounts', { ...cur, deleted_at: null }, 'restored', `Restored account ${cur.name}`);
  });
  notify();
}

// ---- categories -------------------------------------------------------------------------------
export async function saveCategory(input, id = null) {
  const userId = requireUser();
  const f = {};
  if (!input.name?.trim()) f.name = 'Give this category a name.';
  if (!['income', 'expense'].includes(input.kind)) f.kind = 'Choose income or expense.';
  if (Object.keys(f).length) throw new ValidationError(f);
  const siblings = await db.categories.where('[user_id+kind]').equals([userId, input.kind]).filter((c) => !c.deleted_at && c.id !== id && (c.parent_id || null) === (input.parent_id || null)).toArray();
  if (siblings.some((c) => c.name.toLowerCase() === input.name.trim().toLowerCase())) throw new ValidationError({ name: 'You already have a category with this name.' });
  const clean = { kind: input.kind, name: input.name.trim(), parent_id: input.parent_id || null, icon: input.icon || 'circle-dashed', color: input.color || '#7A809B' };
  let saved;
  await db.transaction('rw', RW, async () => {
    if (id) {
      const cur = await db.categories.get(id);
      saved = await writeLocal('categories', { ...cur, ...clean }, 'updated', `Updated category ${clean.name}`);
    } else {
      saved = await writeLocal('categories', { ...newBase(userId), ...clean, archived_at: null }, 'created', `Created category ${clean.name}`);
    }
  });
  notify();
  return saved;
}

export async function setCategoryArchived(id, archived) {
  await db.transaction('rw', RW, async () => {
    const cur = await db.categories.get(id);
    await writeLocal('categories', { ...cur, archived_at: archived ? nowIso() : null }, archived ? 'archived' : 'restored', `${archived ? 'Archived' : 'Unarchived'} category ${cur.name}`);
  });
  notify();
}

/** Categories used by transactions are archived; unused ones are soft-deleted. */
export async function removeCategory(id) {
  const userId = requireUser();
  const used = await db.transactions.where('[user_id+category_id]').equals([userId, id]).filter((t) => !t.purged_at).count();
  const children = await db.categories.where('parent_id').equals(id).filter((c) => !c.deleted_at).count();
  if (used || children) { await setCategoryArchived(id, true); return 'archived'; }
  await db.transaction('rw', RW, async () => {
    const cur = await db.categories.get(id);
    await writeLocal('categories', { ...cur, deleted_at: nowIso() }, 'deleted', `Deleted category ${cur.name}`);
  });
  notify();
  return 'deleted';
}

// ---- transactions ---------------------------------------------------------------------------
export const payeeKey = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function validateTransaction(input, existing = null) {
  const userId = requireUser();
  const f = {};
  if (!['income', 'expense', 'transfer', 'adjustment', 'refund'].includes(input.type)) f.type = 'Choose a transaction type.';
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) f.amount = 'Enter an amount greater than zero.';
  if (!isValidLocalDate(input.date)) f.date = 'Enter a valid date.';
  if (input.time && !/^\d{2}:\d{2}$/.test(input.time)) f.time = 'Enter a valid time.';

  const checkAccount = async (id, field) => {
    if (!id) { f[field] = 'Choose an account.'; return null; }
    const a = await db.accounts.get(id);
    if (!a || a.user_id !== userId || a.deleted_at) { f[field] = 'This account no longer exists.'; return null; }
    const unchanged = existing && (existing.account_id === id || existing.to_account_id === id);
    if (a.archived_at && !unchanged) f[field] = 'This account is archived. Unarchive it first.';
    return a;
  };
  const from = await checkAccount(input.account_id, 'account_id');
  if (input.type === 'transfer') {
    const to = await checkAccount(input.to_account_id, 'to_account_id');
    if (from && to && from.id === to.id) f.to_account_id = 'Pick a different account to transfer to.';
    if (from && to && from.currency !== to.currency) f.to_account_id = 'Transfers between different currencies are not supported yet.';
  }
  if (input.type === 'income' || input.type === 'expense') {
    if (!input.category_id) f.category_id = 'Choose a category.';
    else {
      const c = await db.categories.get(input.category_id);
      if (!c || c.user_id !== userId || c.deleted_at) f.category_id = 'This category no longer exists.';
      else if (c.kind !== input.type) f.category_id = `Pick an ${input.type} category.`;
    }
  }
  if (input.type === 'refund' && input.category_id) {
    const c = await db.categories.get(input.category_id);
    if (!c || c.kind !== 'expense') f.category_id = 'A refund goes back to an expense category.';
  }
  if (input.type === 'adjustment' && !['in', 'out'].includes(input.direction)) f.direction = 'Choose whether the balance goes up or down.';
  if ((input.payee || '').length > 120) f.payee = 'Keep this under 120 characters.';
  if ((input.notes || '').length > 1000) f.notes = 'Keep notes under 1,000 characters.';
  if (Object.keys(f).length) throw new ValidationError(f);
}

export function describeTx(t, accounts) {
  const name = (id) => accounts.get(id)?.name || 'account';
  const amt = formatMoney(t.amount, accounts.get(t.account_id)?.currency || actor.currency);
  switch (t.type) {
    case 'transfer': return `Transfer ${amt} ${name(t.account_id)} → ${name(t.to_account_id)}`;
    case 'income': return `Income ${amt} to ${name(t.account_id)}${t.payee ? ` from ${t.payee}` : ''}`;
    case 'expense': return `Expense ${amt} from ${name(t.account_id)}${t.payee ? ` at ${t.payee}` : ''}`;
    case 'refund': return `Refund ${amt} to ${name(t.account_id)}`;
    case 'adjustment': return `Balance adjustment ${t.direction === 'out' ? '−' : '+'}${amt} on ${name(t.account_id)}`;
    case 'debt': return `${t.debt_role === 'payment' ? 'Debt payment' : 'Loan'} ${t.direction === 'out' ? '−' : '+'}${amt} ${t.direction === 'out' ? 'from' : 'to'} ${name(t.account_id)}${t.payee ? ` (${t.payee})` : ''}`;
    default: return 'Transaction';
  }
}

/** Create or update a transaction. A transfer is ONE record with both sides, so it can never be half-written. */
export async function saveTransaction(input, id = null) {
  const userId = requireUser();
  const existing = id ? await db.transactions.get(id) : null;
  if (id && (!existing || existing.user_id !== userId)) throw new Error('Transaction not found');
  if (input.type === 'debt' || existing?.type === 'debt') throw new ValidationError({ type: 'Loans and repayments are managed in Utang.' });
  await validateTransaction(input, existing);
  const clean = {
    type: input.type,
    amount: input.amount,
    account_id: input.account_id,
    to_account_id: input.type === 'transfer' ? input.to_account_id : null,
    category_id: ['income', 'expense', 'refund'].includes(input.type) ? input.category_id || null : null,
    direction: input.type === 'adjustment' ? input.direction : null,
    refund_of: input.type === 'refund' ? input.refund_of || null : null,
    date: input.date,
    time: input.time || toLocalTime(),
    payee: (input.payee || '').trim(),
    payee_key: payeeKey(input.payee),
    notes: (input.notes || '').trim(),
    tags: [...new Set((input.tags || []).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))]
  };
  let saved;
  await db.transaction('rw', RW, async () => {
    const accounts = new Map((await db.accounts.where('user_id').equals(userId).toArray()).map((a) => [a.id, a]));
    if (existing) {
      const before = describeTx(existing, accounts);
      const after = describeTx(clean, accounts);
      saved = await writeLocal('transactions', { ...existing, ...clean }, 'updated', before === after ? `Edited ${after}` : `Changed ${before} → ${after}`);
    } else {
      saved = await writeLocal('transactions', { ...newBase(userId), ...clean, created_by: userId, purged_at: null }, clean.type === 'transfer' ? 'transferred' : clean.type === 'adjustment' ? 'adjusted' : 'created', describeTx(clean, accounts));
    }
  });
  await setMeta(`lastAccount:${userId}:${clean.type}`, clean.account_id);
  notify();
  return saved;
}

export async function deleteTransaction(id) {
  const userId = requireUser();
  await db.transaction('rw', RW, async () => {
    const cur = await db.transactions.get(id);
    if (!cur || cur.user_id !== userId) throw new Error('Transaction not found');
    const accounts = new Map((await db.accounts.where('user_id').equals(userId).toArray()).map((a) => [a.id, a]));
    await writeLocal('transactions', { ...cur, deleted_at: nowIso() }, 'deleted', `Moved to Trash: ${describeTx(cur, accounts)}`);
  });
  notify();
}

export async function restoreTransaction(id) {
  const userId = requireUser();
  await db.transaction('rw', RW, async () => {
    const cur = await db.transactions.get(id);
    const accounts = new Map((await db.accounts.where('user_id').equals(userId).toArray()).map((a) => [a.id, a]));
    await writeLocal('transactions', { ...cur, deleted_at: null }, 'restored', `Restored: ${describeTx(cur, accounts)}`);
  });
  notify();
}

/** Permanent delete: keeps a tombstone (so other devices learn about it) but wipes the details. */
export async function purgeTransaction(id) {
  const userId = requireUser();
  await db.transaction('rw', RW, async () => {
    const cur = await db.transactions.get(id);
    if (!cur?.deleted_at) throw new Error('Only items in Trash can be permanently deleted.');
    const accounts = new Map((await db.accounts.where('user_id').equals(userId).toArray()).map((a) => [a.id, a]));
    const summary = `Permanently deleted: ${describeTx(cur, accounts)}`;
    await writeLocal('transactions', { ...cur, purged_at: nowIso(), payee: '', payee_key: '', notes: '', tags: [] }, 'purged', summary);
  });
  notify();
}

// ---- reconciliation -------------------------------------------------------------------------
export async function currentBalance(accountId) {
  const userId = requireUser();
  const acc = await db.accounts.get(accountId);
  const txA = await db.transactions.where('[user_id+account_id]').equals([userId, accountId]).toArray();
  const txB = await db.transactions.where('[user_id+to_account_id]').equals([userId, accountId]).toArray();
  return computeBalances([acc], [...txA, ...txB]).get(accountId);
}

/** Records the difference as a visible, auditable adjustment — history is never rewritten. */
export async function reconcile(accountId, actualBalance, note = '') {
  const recorded = await currentBalance(accountId);
  const diff = actualBalance - recorded;
  if (diff === 0) return null;
  const acc = await db.accounts.get(accountId);
  return saveTransaction({
    type: 'adjustment', amount: Math.abs(diff), direction: diff > 0 ? 'in' : 'out', account_id: accountId,
    date: toLocalDate(), time: toLocalTime(), payee: 'Reconciliation',
    notes: `Actual ${formatMoney(actualBalance, acc.currency)} vs recorded ${formatMoney(recorded, acc.currency)}${note ? ` — ${note}` : ''}`,
    tags: []
  });
}

// ---- smart defaults -------------------------------------------------------------------------
/** Suggest a category from this user's own history first, then from built-in hints. */
export async function suggestCategory(payee, kind) {
  const userId = requireUser();
  const key = payeeKey(payee);
  if (key.length < 2) return null;
  const past = await db.transactions.where('[user_id+payee_key]').equals([userId, key]).filter((t) => t.type === kind && !t.deleted_at && t.category_id).reverse().limit(20).toArray();
  if (past.length) {
    const tally = new Map();
    past.forEach((t) => tally.set(t.category_id, (tally.get(t.category_id) || 0) + 1));
    const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const c = await db.categories.get(best[0]);
    if (c && !c.deleted_at && !c.archived_at) return c.id;
  }
  const hintKey = Object.keys(PAYEE_HINTS).find((h) => key === h || key.startsWith(h + ' ') || key.split(' ').includes(h));
  if (!hintKey) return null;
  const name = PAYEE_HINTS[hintKey];
  const cat = await db.categories.where('[user_id+kind]').equals([userId, kind]).filter((c) => c.name === name && !c.deleted_at && !c.archived_at && !c.parent_id).first();
  return cat?.id || null;
}

export async function lastUsedAccount(type) {
  const userId = requireUser();
  return getMeta(`lastAccount:${userId}:${type}`) || getMeta(`lastAccount:${userId}:expense`);
}

export async function recentPayees(kind, limit = 6) {
  const userId = requireUser();
  const seen = new Set();
  const out = [];
  await db.transactions.where('[user_id+date]').between([userId, '0000'], [userId, '9999']).reverse().until(() => out.length >= limit)
    .each((t) => { if (t.type === kind && t.payee && !t.deleted_at && !seen.has(t.payee_key)) { seen.add(t.payee_key); out.push(t.payee); } });
  return out;
}

export { isLiabilityType };
