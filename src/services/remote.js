// Supabase transport for the sync engine. Returns { data, error } like supabase-js.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const cloudEnabled = Boolean(url && key);
export const supabase = cloudEnabled
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'pera-auth' } })
  : null;

const wrapNet = async (fn) => {
  try { return await fn(); } catch (e) { return { data: null, error: { message: e?.message || 'network error' } }; }
};

export const supabaseRemote = supabase && {
  insert: (table, row) => wrapNet(() => supabase.from(table).insert(row).select().single()),
  updateIfVersion: (table, row, version) =>
    wrapNet(() => supabase.from(table).update(row).eq('id', row.id).eq('version', version).select().maybeSingle()),
  fetchOne: (table, id) => wrapNet(() => supabase.from(table).select('*').eq('id', id).maybeSingle()),
  pullSince: (table, since, limit) =>
    wrapNet(() => supabase.from(table).select('*').gte('server_updated_at', since).order('server_updated_at', { ascending: true }).order('id').limit(limit))
};
