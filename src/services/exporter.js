// Export / backup. Everything is generated on-device; nothing is sent anywhere.
import { db } from '../db/db.js';
import { toPlain, currencyInfo } from '../lib/money.js';
import { nowIso } from '../lib/id.js';
import { getActor } from './ledger.js';

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevent CSV formula injection in Excel/Sheets
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportTransactionsCsv(txs, { accounts, cats }) {
  const header = ['Date', 'Time', 'Type', 'Amount', 'Currency', 'Account', 'To account', 'Category', 'Payee', 'Notes', 'Tags', 'Direction', 'ID'];
  const rows = txs.map((t) => {
    const acc = accounts.get(t.account_id);
    const c = currencyInfo(acc?.currency);
    return [t.date, t.time, t.type, toPlain(t.amount, c.decimals).replace(/,/g, ''), c.code, acc?.name, accounts.get(t.to_account_id)?.name || '',
      t.category_id ? cats.label(t.category_id) : '', t.payee, t.notes, (t.tags || []).join(' '), t.direction || '', t.id];
  });
  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  download(`pera-transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

const BACKUP_TABLES = ['accounts', 'categories', 'people', 'debts', 'budgets', 'transactions', 'audit_logs'];
const strip = ({ sync_status, synced_at, ...rest }) => rest;

/** Full backup of this user's data as JSON (restorable). */
export async function createBackup() {
  const { userId } = getActor();
  const data = {};
  for (const t of BACKUP_TABLES) data[t] = (await db[t].where('user_id').equals(userId).toArray()).map(strip);
  const settings = (await db.meta.get(`settings:${userId}`))?.value || null;
  const payload = { app: 'pera', format: 1, created_at: nowIso(), user_id: userId, settings, data };
  download(`pera-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 1), 'application/json');
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, data[t].length]));
}

/** Read and validate a backup file. Nothing is written yet. */
export async function readBackup(file) {
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('This file is not a valid Pera backup.'); }
  if (json?.app !== 'pera' || json.format !== 1 || typeof json.data !== 'object') throw new Error('This file is not a valid Pera backup.');
  for (const t of BACKUP_TABLES) {
    if (!Array.isArray(json.data[t] || [])) throw new Error('This backup file is damaged.');
    for (const r of json.data[t] || []) {
      if (typeof r.id !== 'string') throw new Error('This backup file is damaged.');
      if ((t === 'debts' || t === 'budgets') && (!Number.isSafeInteger(r.amount) || r.amount <= 0)) throw new Error('This backup contains an invalid amount.');
      if (t === 'transactions' && (!Number.isSafeInteger(r.amount) || r.amount <= 0)) throw new Error('This backup contains an invalid amount.');
      if (t === 'accounts' && !Number.isSafeInteger(r.initial_balance)) throw new Error('This backup contains an invalid balance.');
    }
  }
  const { userId } = getActor();
  const summary = {};
  for (const t of BACKUP_TABLES) {
    const rows = json.data[t] || [];
    let added = 0, changed = 0, same = 0;
    for (const r of rows) {
      const cur = await db[t].get(r.id);
      if (!cur) added++;
      else if (cur.updated_at === r.updated_at) same++;
      else changed++;
    }
    summary[t] = { total: rows.length, added, changed, same };
  }
  return { json, summary, created_at: json.created_at, fromOtherUser: json.user_id !== userId };
}

/**
 * Restore = merge. Records missing on this device are added; records that differ are replaced by the
 * backup copy. Nothing here is deleted. Every restored record is queued for sync as a normal edit
 * (so version checks still protect newer changes made on other devices).
 */
export async function restoreBackup(json) {
  const { userId } = getActor();
  const now = nowIso();
  await db.transaction('rw', [db.accounts, db.categories, db.people, db.debts, db.budgets, db.transactions, db.audit_logs, db.outbox], async () => {
    for (const t of BACKUP_TABLES) {
      for (const r of json.data[t] || []) {
        const cur = await db[t].get(r.id);
        if (cur && cur.updated_at === r.updated_at) continue;
        if (cur && cur.user_id !== userId) continue; // never touch other users' rows
        if (t === 'audit_logs' && cur) continue; // audit is append-only
        const row = { ...r, user_id: userId, version: cur?.version || 0, sync_status: 'pending', updated_at: t === 'audit_logs' ? r.updated_at : now };
        if (t === 'transactions') row.payee_key = (row.payee || '').trim().toLowerCase().replace(/\s+/g, ' ');
        await db[t].put(row);
        const key = `${t}:${r.id}`;
        if (!(await db.outbox.where('key').equals(key).count())) await db.outbox.add({ key, table: t, record_id: r.id, user_id: userId, attempts: 0, next_attempt_at: 0, last_error: null });
      }
    }
    const id = crypto.randomUUID();
    await db.audit_logs.add({ id, user_id: userId, entity: 'backup', entity_id: id, action: 'restored', summary: `Restored backup from ${json.created_at?.slice(0, 10)}`, device: getActor().device, at: now, created_at: now, updated_at: now, deleted_at: null, version: 0, sync_status: 'pending' });
    await db.outbox.add({ key: `audit_logs:${id}`, table: 'audit_logs', record_id: id, user_id: userId, attempts: 0, next_attempt_at: 0, last_error: null });
  });
}
