// Push notifications on this device + the user's notification settings (stored in Supabase).
import { supabase, cloudEnabled } from './remote.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export const DEFAULT_SETTINGS = { enabled: true, bills: true, recurring: true, debts: true, budgets: true, low_balance: true, bill_days: [7, 3, 1, 0], send_hour: 8 };

export function pushStatus() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!cloudEnabled || !VAPID_PUBLIC_KEY) return { ok: false, reason: 'setup' };
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
  if (!('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: isIOS && !standalone ? 'ios-install' : 'unsupported' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'blocked' };
  return { ok: true };
}

function keyToBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function isThisDeviceOn() {
  try { return !!(await currentSubscription()); } catch { return false; }
}

export async function loadSettings(userId) {
  const { data, error } = await supabase.from('notification_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULT_SETTINGS, ...data } : null;
}

export async function saveSettings(userId, patch) {
  const row = {
    user_id: userId, ...patch,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila',
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('notification_settings').upsert(row).select().single();
  if (error) throw error;
  return data;
}

/** Ask permission, subscribe this device, and save it. */
export async function turnOnThisDevice(userId, currency) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'blocked' : 'dismissed');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  const device = `${/iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows' : 'Other'}`;
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, device },
    { onConflict: 'user_id,endpoint' }
  );
  if (error) throw error;
  const existing = await loadSettings(userId);
  return existing || saveSettings(userId, { ...DEFAULT_SETTINGS, currency });
}

/** Stop notifications on this device only (other devices keep theirs). Also used on sign-out. */
export async function turnOffThisDevice() {
  if (!('serviceWorker' in navigator) || !supabase) return;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/** Ask the server to send a test notification to all of this user's devices. */
export async function sendTest() {
  const { data, error } = await supabase.functions.invoke('notify', { body: { test: true } });
  if (error) throw error;
  return data;
}