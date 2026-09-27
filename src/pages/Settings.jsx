import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, Monitor, LogOut, Download, Upload, ShieldCheck } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { PageHeader, Segmented, Field, Sheet, useToast } from '../components/ui.jsx';
import InstallCard from '../components/InstallCard.jsx';
import { CURRENCIES } from '../lib/money.js';
import { createBackup, readBackup, restoreBackup } from '../services/exporter.js';
import { supabase } from '../services/remote.js';

export default function Settings() {
  const { user, settings, updateSettings, theme, setTheme, signOut, sync, engine } = useApp();
  const toast = useToast();
  const fileRef = useRef(null);
  const [restore, setRestore] = useState(null);
  const [busy, setBusy] = useState(false);

  async function backup() {
    const counts = await createBackup();
    toast(`Backup downloaded — ${counts.transactions} transactions, ${counts.accounts} accounts`);
  }
  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { setRestore(await readBackup(file)); } catch (err) { toast(err.message, { tone: 'error' }); }
  }
  async function doRestore() {
    setBusy(true);
    try {
      await restoreBackup(restore.json);
      toast('Backup restored');
      setRestore(null);
      engine.sync();
    } catch { toast('Restore failed. Nothing was changed.', { tone: 'error' }); } finally { setBusy(false); }
  }
  async function logout() {
    if (sync.pending > 0 && !confirm(`${sync.pending} change(s) have not synced yet. They stay on this device and will sync next time you sign in here. Sign out anyway?`)) return;
    await signOut();
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />
      <div className="space-y-5">
        <Section title="Profile">
          <p className="text-sm">{user?.local ? 'Device-only mode (no account)' : user?.email}</p>
          {!user?.local && <PasswordChange />}
        </Section>

        <Section title="Display">
          <Field label="Theme">
            <Segmented label="Theme" value={theme} onChange={setTheme} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]} />
          </Field>
          <Field label="Default currency" htmlFor="s-cur" hint="Used for new accounts and totals. Existing accounts keep their currency.">
            <select id="s-cur" className="input" value={settings?.currency || 'PHP'} onChange={(e) => updateSettings({ currency: e.target.value })}>
              {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Install app"><InstallCard /></Section>

        <Section title="Your data">
          <div className="flex flex-wrap gap-2">
            <button className="btn-soft btn-sm" onClick={backup}><Download size={16} /> Backup my data</button>
            <button className="btn-soft btn-sm" onClick={() => fileRef.current?.click()}><Upload size={16} /> Restore backup</button>
            <Link className="btn-soft btn-sm" to="/transactions">Export transactions (CSV)</Link>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pickFile} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-ghost btn-sm" to="/categories">Categories</Link>
            <Link className="btn-ghost btn-sm" to="/trash">Trash</Link>
            <Link className="btn-ghost btn-sm" to="/activity">Activity log</Link>
            <Link className="btn-ghost btn-sm" to="/sync">Sync status</Link>
          </div>
        </Section>

        <Section title="Privacy">
          <p className="text-sm muted flex gap-2"><ShieldCheck size={18} className="shrink-0 text-gain" /> Your records are stored on this device and, when signed in, in your own private cloud database protected by row-level security. Pera has no ads, no analytics and sends your financial data to no third party.</p>
        </Section>

        {!user?.local && <button className="btn-ghost text-loss" onClick={logout}><LogOut size={18} /> Sign out</button>}
      </div>

      <Sheet open={!!restore} onClose={() => setRestore(null)} title="Restore this backup?"
        footer={<div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setRestore(null)}>Cancel</button><button className="btn-primary flex-1" disabled={busy} onClick={doRestore}>Restore</button></div>}>
        {restore && (
          <div className="space-y-3 text-sm">
            <p>Backup from <strong>{new Date(restore.created_at).toLocaleString()}</strong>.</p>
            {restore.fromOtherUser && <p className="text-warn">This backup was made by a different account. Its records will be added to your account.</p>}
            <table className="w-full">
              <thead><tr className="muted text-left"><th className="py-1 font-medium">Records</th><th className="font-medium">New</th><th className="font-medium">Will be replaced</th><th className="font-medium">Unchanged</th></tr></thead>
              <tbody>{Object.entries(restore.summary).filter(([t]) => t !== 'audit_logs').map(([t, s]) => <tr key={t} className="border-t border-ink-100/70 dark:border-night-line"><td className="py-1.5 capitalize">{t}</td><td>{s.added}</td><td>{s.changed}</td><td>{s.same}</td></tr>)}</tbody>
            </table>
            <p className="muted">Nothing is deleted. Records that differ are replaced by the backup copy and the change is logged. Consider making a fresh backup first.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Section({ title, children }) {
  return <section className="card p-5 space-y-4"><h2 className="text-base font-semibold">{title}</h2>{children}</section>;
}

function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();
  async function save() {
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setErr(navigator.onLine ? 'Could not change the password. Try again.' : 'You need to be online to change your password.');
    toast('Password changed'); setOpen(false); setPw('');
  }
  return (
    <>
      <button className="btn-soft btn-sm" onClick={() => setOpen(true)}>Change password</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Change password" footer={<button className="btn-primary w-full" onClick={save}>Change password</button>}>
        <Field label="New password" htmlFor="npw" error={err}><input id="npw" data-autofocus type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} /></Field>
      </Sheet>
    </>
  );
}
