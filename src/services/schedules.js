// Bills + recurring transactions ("schedules").
//
//  kind 'bill'      → you confirm each payment ("Bayad na" / Skip). Status: upcoming → due soon → due today → overdue.
//  kind 'recurring' → auto = true: recorded automatically on its date (catches up when the app opens)
//                     auto = false: waits for you to Record / Skip.
//
// No duplicates: every occurrence has a deterministic transaction id (schedule + date), so two devices
// (or two app opens) can never record the same occurrence twice.
import { db } from '../db/db.js';
import { nowIso } from '../lib/id.js';
import { addDays, isValidLocalDate, parseLocalDate, toLocalDate, toLocalTime } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';
import { RW, ValidationError, getActor, newBase, notify, requireUser, stableId, validateTransaction, writeLocal, payeeKey } from './ledger.js';

export const FREQUENCIES = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'],
  ['quarterly', 'Every 3 months'], ['yearly', 'Yearly'], ['custom', 'Custom']
];
const STEP = { daily: [1, 'day'], weekly: [7, 'day'], biweekly: [14, 'day'], monthly: [1, 'month'], quarterly: [3, 'month'], yearly: [12, 'month'] };
const DUE_SOON_DAYS = 7;

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** Date of the n-th occurrence (0-based). Monthly on the 31st becomes the last day of shorter months. */
export function occurrenceAt(s, n) {
  const [count, unit] = s.frequency === 'custom' ? [Math.max(1, s.interval || 1) * (s.interval_unit === 'week' ? 7 : 1), s.interval_unit === 'month' ? 'month' : 'day'] : STEP[s.frequency];
  if (unit === 'day') return addDays(s.start_date, n * count);
  const start = parseLocalDate(s.start_date);
  const total = start.getMonth() + n * count;
  const y = start.getFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return `${y}-${pad(m + 1)}-${pad(Math.min(start.getDate(), daysInMonth(y, m)))}`;
}

/** All occurrence dates within [from, to], respecting end date, max count and effective_from. */
export function occurrencesBetween(s, from, to) {
  const out = [];
  const min = s.effective_from && s.effective_from > from ? s.effective_from : from;
  for (let n = 0; n < 20000; n++) {
    if (s.max_count && n >= s.max_count) break;
    const d = occurrenceAt(s, n);
    if (d > to || (s.end_date && d > s.end_date)) break;
    if (d >= min) out.push(d);
  }
  return out;
}

export function nextOccurrence(s, after) {
  return occurrencesBetween(s, after, '9999-12-31')[0] || null;
}

export const occurrenceTxId = (userId, scheduleId, date) => stableId(`${userId}:schedule:${scheduleId}:${date}`);

// ---------------------------------------------------------------------------------------------
export async function validateSchedule(input) {
  const f = {};
  if (!input.name?.trim()) f.name = 'Give this a name.';
  if (!['bill', 'recurring'].includes(input.kind)) f.kind = 'Choose bill or recurring.';
  if (!FREQUENCIES.some(([v]) => v === input.frequency)) f.frequency = 'Choose how often.';
  if (input.frequency === 'custom' && (!Number.isInteger(Number(input.interval)) || Number(input.interval) < 1 || Number(input.interval) > 365)) f.interval = 'Use a number from 1 to 365.';
  if (!isValidLocalDate(input.start_date)) f.start_date = 'Enter a valid date.';
  if (input.end_date && !isValidLocalDate(input.end_date)) f.end_date = 'Enter a valid date.';
  else if (input.end_date && input.end_date < input.start_date) f.end_date = 'End date must be after the first date.';
  if (input.max_count != null && input.max_count !== '' && (!Number.isInteger(Number(input.max_count)) || Number(input.max_count) < 1)) f.max_count = 'Use a whole number.';
  if (!(input.kind === 'bill' && input.variable_amount) && (!Number.isSafeInteger(input.amount) || input.amount <= 0)) f.amount = 'Enter an amount greater than zero.';
  // Reuse the normal transaction rules for account / category / transfer checks.
  try {
    await validateTransaction({ type: input.type, amount: input.amount || 1, account_id: input.account_id, to_account_id: input.to_account_id, category_id: input.category_id, date: isValidLocalDate(input.start_date) ? input.start_date : toLocalDate(), direction: null });
  } catch (e) {
    if (e instanceof ValidationError) Object.assign(f, Object.fromEntries(Object.entries(e.fields).filter(([k]) => ['account_id', 'to_account_id', 'category_id', 'type'].includes(k))));
    else throw e;
  }
  if (Object.keys(f).length) throw new ValidationError(f);
}

const TIMING = ['frequency', 'interval', 'interval_unit', 'start_date'];

export async function saveSchedule(input, id = null) {
  const userId = requireUser();
  const clean = {
    kind: input.kind, name: input.name.trim?.() ?? input.name, type: input.kind === 'bill' ? 'expense' : input.type,
    amount: input.amount ?? null, variable_amount: input.kind === 'bill' ? !!input.variable_amount : false,
    account_id: input.account_id, to_account_id: input.type === 'transfer' ? input.to_account_id : null,
    category_id: input.type === 'transfer' ? null : input.category_id || null,
    payee: (input.payee || '').trim(), notes: (input.notes || '').trim(),
    frequency: input.frequency, interval: input.frequency === 'custom' ? Number(input.interval) : null,
    interval_unit: input.frequency === 'custom' ? input.interval_unit || 'day' : null,
    start_date: input.start_date, end_date: input.end_date || null,
    max_count: input.max_count ? Number(input.max_count) : null, auto: input.kind === 'recurring' ? input.auto !== false : false
  };
  if (clean.kind === 'bill') clean.type = 'expense';
  await validateSchedule(clean);
  let saved;
  if (id) await runSchedules(); // record anything due under the old rules first
  await db.transaction('rw', RW, async () => {
    if (id) {
      const cur = await db.schedules.get(id);
      if (!cur || cur.user_id !== userId) throw new Error('Not found');
      const timingChanged = TIMING.some((k) => (cur[k] ?? null) !== (clean[k] ?? null));
      // Changing the timing never rewrites history: new rules apply from today on.
      const effective_from = timingChanged ? toLocalDate() : cur.effective_from || null;
      saved = await writeLocal('schedules', { ...cur, ...clean, effective_from }, 'updated', `Updated ${clean.kind} ${clean.name}`);
    } else {
      saved = await writeLocal('schedules', { ...newBase(userId), ...clean, effective_from: null, skipped: [], paused_at: null },
        'created', `Created ${clean.kind === 'bill' ? 'bill' : 'recurring'} ${clean.name}${clean.amount ? ` ${formatMoney(clean.amount, getActor().currency)}` : ''}`);
    }
  });
  notify();
  const caughtUp = !id ? await runSchedules() : 0;
  return { ...saved, caughtUp };
}

export async function setPaused(id, paused, today = toLocalDate()) {
  await db.transaction('rw', RW, async () => {
    const s = await db.schedules.get(id);
    if (paused) {
      await writeLocal('schedules', { ...s, paused_at: nowIso() }, 'updated', `Paused ${s.name}`);
    } else {
      // Occurrences that fell inside the pause are marked skipped, so resuming doesn't back-fill them.
      const from = s.paused_at.slice(0, 10) <= today ? s.paused_at.slice(0, 10) : today;
      const missed = occurrencesBetween(s, from, addDays(today, -1));
      await writeLocal('schedules', { ...s, paused_at: null, skipped: [...new Set([...(s.skipped || []), ...missed])] }, 'restored', `Resumed ${s.name}`);
    }
  });
  notify();
  if (!paused) await runSchedules(today);
}

export async function deleteSchedule(id) {
  await db.transaction('rw', RW, async () => {
    const s = await db.schedules.get(id);
    await writeLocal('schedules', { ...s, deleted_at: nowIso() }, 'deleted', `Deleted ${s.kind} ${s.name} (past transactions kept)`);
  });
  notify();
}

export async function restoreSchedule(id) {
  await db.transaction('rw', RW, async () => {
    const s = await db.schedules.get(id);
    await writeLocal('schedules', { ...s, deleted_at: null }, 'restored', `Restored ${s.name}`);
  });
  notify();
}

// ---------------------------------------------------------------------------------------------
function occurrenceTx(s, date, { amount, account_id, paid_on, notes }) {
  return {
    type: s.type, amount, account_id: account_id || s.account_id, to_account_id: s.type === 'transfer' ? s.to_account_id : null,
    category_id: s.type === 'transfer' ? null : s.category_id, direction: null, refund_of: null, debt_id: null, debt_role: null,
    schedule_id: s.id, occurrence_date: date, date: paid_on || date, time: toLocalTime(), payee: s.payee || s.name,
    payee_key: payeeKey(s.payee || s.name), notes: notes ?? s.notes ?? '', tags: [], deleted_at: null, purged_at: null
  };
}

/**
 * Record (or re-record) one occurrence. Used by "Bayad na", "Record" and the automation.
 * The id is deterministic, so the same occurrence always maps to the same transaction.
 */
export async function recordOccurrence(scheduleId, date, opts = {}) {
  const userId = requireUser();
  const s = await db.schedules.get(scheduleId);
  if (!s || s.user_id !== userId || s.deleted_at) throw new Error('Not found');
  const amount = opts.amount ?? s.amount;
  const f = {};
  if (!Number.isSafeInteger(amount) || amount <= 0) f.amount = 'Enter the amount paid.';
  if (opts.paid_on && !isValidLocalDate(opts.paid_on)) f.paid_on = 'Enter a valid date.';
  if (Object.keys(f).length) throw new ValidationError(f);
  const tx = occurrenceTx(s, date, { ...opts, amount });
  await validateTransaction({ ...tx });
  const id = await occurrenceTxId(userId, s.id, date);
  let saved;
  await db.transaction('rw', RW, async () => {
    const existing = await db.transactions.get(id);
    if (existing && !existing.deleted_at && !existing.purged_at) { saved = existing; return; }
    const label = `${s.kind === 'bill' ? 'Paid bill' : 'Recorded'} ${s.name} ${formatMoney(amount, getActor().currency)} (due ${date})`;
    const base = existing ? { ...existing, purged_at: null } : { ...newBase(userId), id, created_by: userId };
    saved = await writeLocal('transactions', { ...base, ...tx }, 'created', opts.silent ? null : label);
    if ((s.skipped || []).includes(date)) await writeLocal('schedules', { ...s, skipped: s.skipped.filter((d) => d !== date) }, null, null);
  });
  notify();
  return saved;
}

export async function skipOccurrence(scheduleId, date) {
  await db.transaction('rw', RW, async () => {
    const s = await db.schedules.get(scheduleId);
    await writeLocal('schedules', { ...s, skipped: [...new Set([...(s.skipped || []), date])] }, 'updated', `Skipped ${s.name} due ${date}`);
  });
  notify();
}

export async function unskipOccurrence(scheduleId, date) {
  await db.transaction('rw', RW, async () => {
    const s = await db.schedules.get(scheduleId);
    await writeLocal('schedules', { ...s, skipped: (s.skipped || []).filter((d) => d !== date) }, 'restored', `Un-skipped ${s.name} due ${date}`);
  });
  notify();
}

/** Undo a payment: the transaction goes to Trash and the occurrence is unpaid again. */
export async function unpayOccurrence(scheduleId, date) {
  const userId = requireUser();
  const id = await occurrenceTxId(userId, scheduleId, date);
  await db.transaction('rw', RW, async () => {
    const t = await db.transactions.get(id);
    if (t && !t.deleted_at) await writeLocal('transactions', { ...t, deleted_at: nowIso() }, 'deleted', `Undid payment: ${t.payee} due ${date}`);
  });
  notify();
}

// ---------------------------------------------------------------------------------------------
/**
 * Status of every occurrence of a schedule from its start up to `until`.
 * Returns [{ date, state: 'paid'|'skipped'|'overdue'|'today'|'soon'|'upcoming', tx }]
 */
export async function occurrenceStates(s, txById, today = toLocalDate(), until = addDays(today, 45)) {
  const userId = s.user_id;
  const dates = occurrencesBetween(s, s.start_date, until);
  const out = [];
  for (const date of dates) {
    const id = await occurrenceTxId(userId, s.id, date);
    const tx = txById.get(id);
    let state;
    if (tx && !tx.deleted_at && !tx.purged_at) state = 'paid';
    else if ((s.skipped || []).includes(date)) state = 'skipped';
    else if (date < today) state = 'overdue';
    else if (date === today) state = 'today';
    else if (date <= addDays(today, DUE_SOON_DAYS)) state = 'soon';
    else state = 'upcoming';
    out.push({ date, state, tx: tx && !tx.deleted_at ? tx : null });
  }
  return out;
}

/** Summary used by lists and the dashboard. */
export async function scheduleSummary(s, txById, today = toLocalDate()) {
  const all = await occurrenceStates(s, txById, today);
  const open = all.filter((o) => ['overdue', 'today', 'soon', 'upcoming'].includes(o.state));
  const overdue = open.filter((o) => o.state === 'overdue');
  const current = open[0] || null; // oldest unpaid occurrence
  const history = all.filter((o) => o.date <= today || o.state === 'paid' || o.state === 'skipped').slice(-8).reverse();
  return { current, overdue, history, all, next: nextOccurrence(s, today) };
}

// ---------------------------------------------------------------------------------------------
let running = null;
/**
 * Automation: record every due occurrence of auto-recurring schedules up to today.
 * Safe to call often and from several devices (deterministic ids + existence check).
 */
export async function runSchedules(today = toLocalDate()) {
  if (running) return running;
  running = (async () => {
    let userId;
    try { userId = requireUser(); } catch { return 0; }
    const list = await db.schedules.where('user_id').equals(userId).filter((s) => !s.deleted_at && !s.paused_at && s.kind === 'recurring' && s.auto).toArray();
    let created = 0;
    for (const s of list) {
      for (const date of occurrencesBetween(s, s.start_date, today)) {
        if ((s.skipped || []).includes(date)) continue;
        const id = await occurrenceTxId(userId, s.id, date);
        if (await db.transactions.get(id)) continue; // already recorded (or deleted on purpose)
        try {
          await recordOccurrence(s.id, date, { silent: false });
          created++;
        } catch { break; /* e.g. account archived: try again next time */ }
      }
    }
    return created;
  })();
  try { return await running; } finally { running = null; }
}