import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { db, getMeta, setMeta } from '../db/db.js';
import { cloudEnabled, supabase, supabaseRemote } from './remote.js';
import { createSyncEngine } from './sync.js';
import { setActor, ensureDefaultCategories, onLocalChange } from './ledger.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const LAST_USER = 'pera-last-user';
const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const standalone = matchMedia('(display-mode: standalone)').matches;
  return `${os} ${standalone ? 'app' : 'browser'}`;
};

export function AppProvider({ children }) {
  const [auth, setAuth] = useState({ loading: true, user: null, recovery: false });
  const [settings, setSettings] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [sync, setSync] = useState({ status: 'idle', pending: 0, conflicts: 0 });
  const [theme, setThemeState] = useState(() => localStorage.getItem('pera-theme') || 'system');
  const userRef = useRef(null);

  // ---- auth ----
  useEffect(() => {
    if (!cloudEnabled) {
      setAuth({ loading: false, user: { id: 'local', email: null, local: true }, recovery: false });
      return;
    }
    let cancelled = false;
    const fromSession = (s) => (s?.user ? { id: s.user.id, email: s.user.email } : null);
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      let user = fromSession(data.session);
      // Offline with an expired/unrefreshable session: still open this device's data. Sync resumes after login.
      if (!user && !navigator.onLine) {
        try { const last = JSON.parse(localStorage.getItem(LAST_USER) || 'null'); if (last) user = { ...last, offlineOnly: true }; } catch { /* ignore */ }
      }
      setAuth({ loading: false, user, recovery: false });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const user = fromSession(session);
      if (user) localStorage.setItem(LAST_USER, JSON.stringify(user));
      setAuth((a) => ({ loading: false, user: user || (a.user?.offlineOnly && !navigator.onLine ? a.user : null), recovery: event === 'PASSWORD_RECOVERY' ? true : a.recovery && event !== 'USER_UPDATED' }));
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const user = auth.user;
  userRef.current = user;

  // ---- sync engine (one per app) ----
  const engine = useMemo(() => createSyncEngine({
    remote: supabaseRemote,
    getUserId: () => (userRef.current && !userRef.current.local && !userRef.current.offlineOnly ? userRef.current.id : null)
  }), []);
  useEffect(() => engine.subscribe(setSync), [engine]);

  // ---- per-user boot ----
  useEffect(() => {
    if (!user) { setSettings(null); return; }
    let alive = true;
    (async () => {
      const s = await getMeta(`settings:${user.id}`, { currency: 'PHP', onboarded: false });
      setActor({ userId: user.id, device: deviceName(), currency: s.currency });
      if (!user.local && navigator.onLine) await engine.sync(); // pull first so defaults aren't duplicated
      await ensureDefaultCategories(user.id);
      // A returning user on a new device already has accounts → skip onboarding.
      if (!s.onboarded && (await db.accounts.where('user_id').equals(user.id).count()) > 0) { s.onboarded = true; await setMeta(`settings:${user.id}`, s); }
      if (alive) setSettings(s);
      engine.refreshCounts();
    })();
    return () => { alive = false; };
  }, [user?.id, engine]);

  // ---- sync triggers ----
  useEffect(() => {
    if (!user || user.local) return;
    let t;
    const soon = () => { clearTimeout(t); t = setTimeout(() => engine.sync(), 800); };
    const off = onLocalChange(soon);
    const goOnline = () => { setOnline(true); engine.retryNow(); };
    const goOffline = () => { setOnline(false); engine.sync(); };
    const vis = () => { if (document.visibilityState === 'visible') engine.sync(); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', vis);
    const iv = setInterval(() => engine.sync(), 60_000);
    return () => { off(); clearTimeout(t); clearInterval(iv); window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); document.removeEventListener('visibilitychange', vis); };
  }, [user?.id, engine]);

  useEffect(() => {
    if (user && !user.local) return;
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [user?.id]);

  // ---- theme ----
  const setTheme = useCallback((t) => {
    localStorage.setItem('pera-theme', t);
    setThemeState(t);
  }, []);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0E1328' : '#141B3C');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const updateSettings = useCallback(async (patch) => {
    const next = { ...settings, ...patch };
    await setMeta(`settings:${user.id}`, next);
    if (patch.currency) setActor({ currency: patch.currency });
    setSettings(next);
    if (patch.currency && supabase && !user.local && navigator.onLine) supabase.from('profiles').upsert({ id: user.id, currency: patch.currency, updated_at: new Date().toISOString() }).then(() => {});
  }, [settings, user]);

  const signOut = useCallback(async () => {
    localStorage.removeItem(LAST_USER);
    if (supabase) await supabase.auth.signOut();
    setAuth({ loading: false, user: null, recovery: false });
  }, []);

  const value = { auth, user, settings, updateSettings, online, sync, engine, theme, setTheme, signOut, cloudEnabled, currency: settings?.currency || 'PHP' };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// ---- PWA install + update ----
export function usePwa() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(() => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const install = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome === 'accepted';
  };
  return { canPrompt: !!deferred, install, installed, isIOS };
}
