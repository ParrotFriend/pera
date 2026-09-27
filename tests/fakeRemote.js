// In-memory stand-in for Supabase that mimics the server triggers (version bump, server_updated_at).
export function createFakeRemote() {
  const tables = { accounts: new Map(), categories: new Map(), transactions: new Map(), audit_logs: new Map() };
  let clock = Date.parse('2026-09-01T00:00:00Z');
  const tick = () => new Date((clock += 1000)).toISOString();
  const r = {
    online: true, calls: 0, dropNextResponse: false, tables,
    async insert(table, row) {
      r.calls++;
      if (!r.online) return { data: null, error: { message: 'Failed to fetch' } };
      if (tables[table].has(row.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      const saved = { ...row, version: 1, server_updated_at: tick() };
      tables[table].set(row.id, saved);
      if (r.dropNextResponse) { r.dropNextResponse = false; return { data: null, error: { message: 'network timeout' } }; }
      return { data: { ...saved }, error: null };
    },
    async updateIfVersion(table, row, version) {
      r.calls++;
      if (!r.online) return { data: null, error: { message: 'Failed to fetch' } };
      const cur = tables[table].get(row.id);
      if (!cur || cur.version !== version) return { data: null, error: null };
      const saved = { ...cur, ...row, version: cur.version + 1, server_updated_at: tick() };
      tables[table].set(row.id, saved);
      return { data: { ...saved }, error: null };
    },
    async fetchOne(table, id) {
      if (!r.online) return { data: null, error: { message: 'Failed to fetch' } };
      const cur = tables[table].get(id);
      return { data: cur ? { ...cur } : null, error: null };
    },
    async pullSince(table, since, limit) {
      if (!r.online) return { data: null, error: { message: 'Failed to fetch' } };
      const rows = [...tables[table].values()].filter((x) => x.server_updated_at >= since).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, limit);
      return { data: rows.map((x) => ({ ...x })), error: null };
    },
    /** Simulate another device editing a row directly on the server. */
    remoteEdit(table, id, patch) {
      const cur = tables[table].get(id);
      tables[table].set(id, { ...cur, ...patch, version: cur.version + 1, server_updated_at: tick() });
    }
  };
  return r;
}
