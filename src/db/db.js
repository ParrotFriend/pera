import Dexie from 'dexie';

// Local-first database. Every synced record carries:
//   id (uuid), user_id, created_at, updated_at, deleted_at,
//   version       -> last server version this copy is based on (0 = never reached the server)
//   sync_status   -> 'pending' | 'synced' | 'conflict'
//   synced_at     -> last time this record was confirmed by the server
export const db = new Dexie('pera');

db.version(1).stores({
  accounts: 'id, user_id, [user_id+archived_at], sync_status',
  categories: 'id, user_id, [user_id+kind], parent_id, sync_status',
  transactions:
    'id, user_id, [user_id+date], [user_id+account_id], [user_id+to_account_id], [user_id+category_id], [user_id+payee_key], deleted_at, sync_status',
  audit_logs: 'id, user_id, [user_id+at], entity_id, sync_status',
  outbox: '++seq, &key, user_id, next_attempt_at', // key = `${table}:${id}` (one entry per dirty record)
  conflicts: '&key, user_id, table, record_id',
  meta: '&key' // settings, pull cursors, onboarding flags
});

export const SYNCED_TABLES = ['accounts', 'categories', 'transactions', 'audit_logs'];

// Columns we send to the server per table (local-only fields like sync_status are stripped).
export const SERVER_COLUMNS = {
  accounts: ['id', 'user_id', 'name', 'type', 'initial_balance', 'currency', 'description', 'icon', 'color', 'low_balance_threshold', 'include_in_total', 'sort_order', 'archived_at', 'created_at', 'updated_at', 'deleted_at', 'version'],
  categories: ['id', 'user_id', 'kind', 'name', 'parent_id', 'icon', 'color', 'archived_at', 'created_at', 'updated_at', 'deleted_at', 'version'],
  transactions: ['id', 'user_id', 'type', 'amount', 'account_id', 'to_account_id', 'category_id', 'direction', 'refund_of', 'date', 'time', 'payee', 'notes', 'tags', 'created_by', 'created_at', 'updated_at', 'deleted_at', 'purged_at', 'version'],
  audit_logs: ['id', 'user_id', 'entity', 'entity_id', 'action', 'summary', 'device', 'at', 'created_at', 'updated_at', 'deleted_at', 'version']
};

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}
export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}
