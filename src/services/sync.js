// Sync engine.
//
//   LOCAL WRITE ─▶ outbox (dirty record keys) ─▶ push ─▶ server confirms (new version) ─▶ mark synced
//   server changes since cursor ─▶ pull ─▶ apply unless the local copy has unsynced edits
//
// Optimistic concurrency: every server row has a `version` bumped by a trigger on each update.
// A local edit remembers the version it was based on and the update is sent as
//   UPDATE ... WHERE id = $id AND version = $base
// If no row matches, someone else changed it: we record a CONFLICT and never overwrite silently.
import { db, SERVER_COLUMNS, SYNCED_TABLES, getMeta, setMeta } from '../db/db.js';
import { nowIso } from '../lib/id.js';
import { payeeKey } from './ledger.js';

const TABLE_ORDER = { accounts: 0, categories: 1, transactions: 2, audit_logs: 3 }; // parents before children
const COMPARE_IGNORE = new Set(['version', 'updated_at', 'created_at', 'server_updated_at']);
const MAX_BACKOFF = 10 * 60 * 1000;

export const toServer = (table, row) => Object.fromEntries(SERVER_COLUMNS[table].filter((k) => k !== 'version' && k in row).map((k) => [k, row[k]]));

function fromServer(table, row) {
  const local = { ...row, sync_status: 'synced', synced_at: nowIso() };
  if (table === 'transactions') {
    local.payee_key = payeeKey(row.payee);
    local.tags = row.tags || [];
  }
  return local;
}

export function sameContent(table, a, b) {
  return SERVER_COLUMNS[table].every((k) => {
    if (COMPARE_IGNORE.has(k)) return true;
    const x = a[k] ?? null, y = b[k] ?? null;
    return JSON.stringify(x) === JSON.stringify(y);
  });
}

/** Network failures are retried; server errors (constraint, permission) are surfaced. */
const isNetworkError = (e) => !e?.code || e.code === 'NETWORK' || /fetch|network|timeout/i.test(e.message || '');
const isRetryableServer = (e) => e?.code === '23503'; // FK: parent not pushed yet

export function createSyncEngine({ remote, getUserId, isOnline = () => navigator.onLine }) {
  let running = null;
  const state = { status: 'idle', pending: 0, conflicts: 0, lastSyncedAt: null, lastError: null };
  const subs = new Set();
  const emit = () => subs.forEach((fn) => fn({ ...state }));
  const set = (patch) => { Object.assign(state, patch); emit(); };

  async function refreshCounts() {
    const userId = getUserId();
    if (!userId) return;
    const [pending, conflicts] = await Promise.all([
      db.outbox.where('user_id').equals(userId).count(),
      db.conflicts.where('user_id').equals(userId).count()
    ]);
    set({ pending, conflicts });
  }

  async function recordConflict(table, local, server) {
    await db.transaction('rw', [db[table], db.conflicts, db.outbox], async () => {
      await db.conflicts.put({ key: `${table}:${local.id}`, user_id: local.user_id, table, record_id: local.id, server, detected_at: nowIso() });
      await db[table].update(local.id, { sync_status: 'conflict' });
      await db.outbox.where('key').equals(`${table}:${local.id}`).delete(); // parked until the user decides
    });
  }

  /** After the server accepted `sent`, mark synced — unless the user edited it again meanwhile. */
  async function confirm(table, sent, serverRow, entry) {
    await db.transaction('rw', [db[table], db.outbox], async () => {
      const now = await db[table].get(sent.id);
      if (!now) return;
      if (now.updated_at === sent.updated_at) {
        await db[table].put({ ...now, version: serverRow.version, sync_status: 'synced', synced_at: nowIso() });
        await db.outbox.delete(entry.seq);
      } else {
        await db[table].update(sent.id, { version: serverRow.version }); // newer local edit stays queued
      }
    });
  }

  async function pushOne(entry) {
    const { table, record_id } = entry;
    const local = await db[table].get(record_id);
    if (!local) { await db.outbox.delete(entry.seq); return; }
    const payload = toServer(table, local);

    if (!local.version) {
      const { data, error } = await remote.insert(table, payload);
      if (!error) return confirm(table, local, data, entry);
      if (error.code !== '23505') throw error;
      // Already on the server (e.g. retried after a lost response, or a default category from another device).
      const { data: server, error: e2 } = await remote.fetchOne(table, record_id);
      if (e2) throw e2;
      if (sameContent(table, local, server)) return confirm(table, local, server, entry);
      return recordConflict(table, local, server);
    }

    const { data, error } = await remote.updateIfVersion(table, payload, local.version);
    if (error) throw error;
    if (data) return confirm(table, local, data, entry);
    const { data: server, error: e2 } = await remote.fetchOne(table, record_id);
    if (e2) throw e2;
    if (!server) { // vanished on server: re-create
      const r = await remote.insert(table, payload);
      if (r.error) throw r.error;
      return confirm(table, local, r.data, entry);
    }
    if (sameContent(table, local, server)) return confirm(table, local, server, entry);
    return recordConflict(table, local, server);
  }

  async function push(userId) {
    const now = Date.now();
    const entries = (await db.outbox.where('user_id').equals(userId).toArray())
      .filter((e) => (e.next_attempt_at || 0) <= now)
      .sort((a, b) => TABLE_ORDER[a.table] - TABLE_ORDER[b.table] || a.seq - b.seq);
    for (const entry of entries) {
      try {
        await pushOne(entry);
      } catch (e) {
        const attempts = (entry.attempts || 0) + 1;
        const delay = Math.min(MAX_BACKOFF, 5000 * 2 ** (attempts - 1));
        await db.outbox.update(entry.seq, { attempts, next_attempt_at: Date.now() + delay, last_error: e.message || String(e) });
        if (isNetworkError(e)) throw e; // stop: we're offline, try the whole batch later
        if (!isRetryableServer(e)) set({ lastError: 'Some changes could not be saved to the cloud. They are still safe on this device.' });
      }
    }
  }

  async function applyPulled(table, row) {
    const local = await db[table].get(row.id);
    if (!local || local.sync_status === 'synced') return db[table].put(fromServer(table, row));
    if (local.sync_status === 'conflict') {
      const c = await db.conflicts.get(`${table}:${row.id}`);
      if (c) await db.conflicts.update(c.key, { server: row });
      return;
    }
    // Local copy has unsynced edits.
    if (row.version <= (local.version || 0)) return; // server hasn't moved past our base; our push will win
    if (sameContent(table, local, row)) {
      await db[table].put(fromServer(table, row));
      await db.outbox.where('key').equals(`${table}:${row.id}`).delete();
      return;
    }
    await recordConflict(table, local, row);
  }

  async function pull(userId) {
    for (const table of SYNCED_TABLES) {
      const cursorKey = `cursor:${userId}:${table}`;
      let cursor = await getMeta(cursorKey, '1970-01-01T00:00:00Z');
      for (let guard = 0; guard < 200; guard++) {
        // Overlap by 30s to tolerate server clock / commit-order skew; applying is idempotent.
        const since = new Date(new Date(cursor).getTime() - 30000).toISOString();
        const { data, error } = await remote.pullSince(table, since, 500);
        if (error) throw error;
        if (!data.length) break;
        await db.transaction('rw', [db[table], db.conflicts, db.outbox], async () => {
          for (const row of data) await applyPulled(table, row);
        });
        const last = data[data.length - 1].server_updated_at;
        if (last === cursor || data.length < 500) { cursor = last > cursor ? last : cursor; break; }
        cursor = last;
      }
      await setMeta(cursorKey, cursor);
    }
  }

  async function run() {
    const userId = getUserId();
    if (!userId || !remote) return;
    if (!isOnline()) { set({ status: 'offline' }); await refreshCounts(); return; }
    set({ status: 'syncing' });
    try {
      await push(userId);
      await pull(userId);
      await push(userId); // anything that became dirty during pull
      set({ status: 'synced', lastSyncedAt: nowIso() });
      if (!(await db.outbox.where('user_id').equals(userId).filter((e) => e.last_error).count())) set({ lastError: null });
    } catch (e) {
      set({ status: isNetworkError(e) ? 'offline' : 'error', lastError: isNetworkError(e) ? null : 'Sync failed. Your data is safe on this device and we will retry.' });
    }
    await refreshCounts();
  }

  return {
    subscribe(fn) { subs.add(fn); fn({ ...state }); return () => subs.delete(fn); },
    getState: () => ({ ...state }),
    refreshCounts,
    /** Coalesces concurrent calls into one run (plus one follow-up if requested mid-run). */
    sync() {
      if (running) { running.again = true; return running.promise; }
      const ctl = { again: false };
      ctl.promise = (async () => {
        do { ctl.again = false; await run(); } while (ctl.again);
        running = null;
      })();
      running = ctl;
      return ctl.promise;
    },
    /** Manual retry: clear backoff and sync now. */
    async retryNow() {
      const userId = getUserId();
      await db.outbox.where('user_id').equals(userId).modify({ next_attempt_at: 0 });
      return this.sync();
    },
    async resolveConflict(key, choice) {
      const c = await db.conflicts.get(key);
      if (!c) return;
      const { table, record_id, server } = c;
      await db.transaction('rw', [db[table], db.conflicts, db.outbox], async () => {
        const local = await db[table].get(record_id);
        if (choice === 'server') {
          await db[table].put(fromServer(table, server));
        } else {
          // Keep this device's version: rebase on the server version so the next push overwrites deliberately.
          await db[table].put({ ...local, version: server.version, sync_status: 'pending', updated_at: nowIso() });
          await db.outbox.where('key').equals(`${table}:${record_id}`).delete();
          await db.outbox.add({ key: `${table}:${record_id}`, table, record_id, user_id: local.user_id, attempts: 0, next_attempt_at: 0, last_error: null });
        }
        await db.conflicts.delete(key);
      });
      await refreshCounts();
      this.sync();
    }
  };
}
