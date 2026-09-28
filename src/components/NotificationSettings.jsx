import { useEffect, useState } from 'react';
import { Bell, BellOff, Send } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { useToast } from './ui.jsx';
import * as Push from '../services/push.js';

const TYPES = [
  ['bills', 'Bills', 'Before a bill is due, and when it becomes overdue'],
  ['recurring', 'Recurring (ask first)', 'When an "Ask me first" item is due'],
  ['debts', 'Utang', 'When a loan is due tomorrow, today, or overdue'],
  ['budgets', 'Budgets', 'When a budget is almost used, reached, or exceeded'],
  ['low_balance', 'Low balance', 'When an account drops below its alert amount']
];
const DAYS = [[7, '7 days'], [3, '3 days'], [1, '1 day'], [0, 'On the day']];

export default function NotificationSettings() {
  const { user, online, currency } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState(() => Push.pushStatus());
  const [deviceOn, setDeviceOn] = useState(false);
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const cloud = user && !user.local && !user.offlineOnly;

  useEffect(() => {
    if (!cloud || !status.ok) return;
    Push.isThisDeviceOn().then(setDeviceOn);
    if (online) Push.loadSettings(user.id).then(setSettings).catch(() => {});
  }, [cloud, status.ok, online, user?.id]);

  if (!cloud) return <p className="text-sm muted">Notifications need a Pera account with cloud sync, because reminders are sent by the server even when the app is closed.</p>;
  if (!status.ok) {
    const msg = {
      setup: 'Notifications are not set up for this app yet (missing VITE_VAPID_PUBLIC_KEY).',
      'ios-install': 'On iPhone/iPad, first add Pera to your Home Screen (Share → Add to Home Screen), then open it from there to turn on notifications. Needs iOS 16.4 or newer.',
      blocked: 'Notifications are blocked for this site. Allow them in your browser or phone settings (Site settings → Notifications), then come back.',
      unsupported: 'This browser does not support notifications. Try Chrome, Edge, Firefox or Safari.'
    }[status.reason];
    return <p className="text-sm muted">{msg}</p>;
  }

  async function turnOn() {
    setBusy(true);
    try {
      const s = await Push.turnOnThisDevice(user.id, currency);
      setSettings(s.enabled ? s : await Push.saveSettings(user.id, { enabled: true, currency }));
      setDeviceOn(true);
      toast('Notifications are on for this device');
    } catch (e) {
      if (e.message === 'blocked') setStatus(Push.pushStatus());
      toast(e.message === 'dismissed' ? 'Notifications were not allowed.' : !navigator.onLine ? 'Connect to the internet to turn on notifications.' : 'Could not turn on notifications. Please try again.', { tone: 'error' });
    } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true);
    try { await Push.turnOffThisDevice(); setDeviceOn(false); toast('Notifications are off for this device'); }
    catch { toast('Could not turn off notifications. Please try again.', { tone: 'error' }); }
    finally { setBusy(false); }
  }
  async function update(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { await Push.saveSettings(user.id, { ...patch, currency }); }
    catch { setSettings(settings); toast(online ? 'Could not save. Please try again.' : 'Connect to the internet to change notification settings.', { tone: 'error' }); }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await Push.sendTest();
      toast(r?.sent ? `Test sent to ${r.sent} device${r.sent > 1 ? 's' : ''}` : 'No device received it. Turn notifications on first.', { tone: r?.sent ? 'success' : 'info' });
    } catch { toast(online ? 'The notification server is not set up yet, or did not respond.' : 'Connect to the internet to send a test.', { tone: 'error' }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {deviceOn
          ? <><span className="inline-flex items-center gap-1.5 text-sm text-gain dark:text-gain-dark font-medium"><Bell size={16} /> On for this device</span>
              <button className="btn-soft btn-sm" disabled={busy} onClick={turnOff}><BellOff size={15} /> Turn off</button></>
          : <button className="btn-primary btn-sm" disabled={busy || !online} onClick={turnOn}><Bell size={15} /> Turn on notifications</button>}
        {deviceOn && <button className="btn-ghost btn-sm" disabled={busy || !online} onClick={test}><Send size={15} /> Send a test</button>}
      </div>
      {!online && <p className="text-[13px] muted">You're offline. Connect to change notification settings.</p>}

      {deviceOn && settings && (
        <>
          <ul className="divide-y divide-ink-100/70 dark:divide-night-line">
            {TYPES.map(([k, label, hint]) => (
              <li key={k}>
                <label className="flex items-start gap-3 py-2.5 cursor-pointer">
                  <input type="checkbox" className="h-5 w-5 mt-0.5 accent-ink" checked={!!settings[k]} disabled={!online} onChange={(e) => update({ [k]: e.target.checked })} />
                  <span><span className="block text-sm font-medium">{label}</span><span className="block text-[12.5px] muted">{hint}</span></span>
                </label>
              </li>
            ))}
          </ul>
          {settings.bills && (
            <div>
              <p className="field-label">Remind me about bills</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map(([d, l]) => {
                  const on = (settings.bill_days || []).includes(d);
                  return <button key={d} type="button" disabled={!online} className={`chip ${on ? 'chip-on' : ''}`} aria-pressed={on}
                    onClick={() => update({ bill_days: on ? settings.bill_days.filter((x) => x !== d) : [...(settings.bill_days || []), d].sort((a, b) => b - a) })}>{l}{d ? ' before' : ''}</button>;
                })}
              </div>
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="n-hour">Send reminders from</label>
            <select id="n-hour" className="input max-w-[12rem]" value={settings.send_hour} disabled={!online} onChange={(e) => update({ send_hour: Number(e.target.value) })}>
              {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}</option>)}
            </select>
            <p className="text-[12.5px] muted mt-1.5">Checked every hour. Each reminder is sent once. Uses this device's time zone.</p>
          </div>
        </>
      )}
    </div>
  );
}