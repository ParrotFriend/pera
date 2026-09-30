import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, Monitor, LogOut, Download, Upload, ShieldCheck } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { PageHeader, Segmented, Field, Sheet, useToast } from '../components/ui.jsx';
import InstallCard from '../components/InstallCard.jsx';
import NotificationSettings from '../components/NotificationSettings.jsx';
import { turnOffThisDevice } from '../services/push.js';
import PasswordField, { ConfirmPasswordField, passwordProblems, problemText } from '../components/PasswordField.jsx';
import { PrivacySheet } from '../components/PrivacyPolicy.jsx';
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
    await turnOffThisDevice().catch(() => {}); // don't show your reminders to the next person using this device
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

        <Section title="Notifications"><NotificationSettings /></Section>

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

        <Section title="Privacy"><PrivacySection /></Section>

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
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const close = () => { setOpen(false); setPw(''); setConfirm(''); setErr({}); };
  async function save() {
    const f = {};
    const problems = passwordProblems(pw);
    if (problems.length) f.pw = problemText(problems);
    if (!confirm) f.confirm = 'Type the password again.';
    else if (confirm !== pw) f.confirm = 'The two passwords don’t match.';
    setErr(f);
    if (Object.keys(f).length) return;
    if (!navigator.onLine) return setErr({ pw: 'You need to be online to change your password.' });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr({ pw: /same|different/i.test(error.message) ? 'Use a password different from your current one.' : /weak|should contain/i.test(error.message) ? 'That password is too weak. Follow the checklist.' : 'Could not change the password. Try again.' });
    toast('Password changed');
    close();
  }
  return (
    <>
      <button className="btn-soft btn-sm" onClick={() => setOpen(true)}>Change password</button>
      <Sheet open={open} onClose={close} title="Change password" footer={<button className="btn-primary w-full" disabled={busy} onClick={save}>Change password</button>}>
        <div className="space-y-5">
          <PasswordField id="npw" label="New password" value={pw} onChange={(v) => { setPw(v); setErr({}); }} autoComplete="new-password" error={err.pw} showRules autoFocus />
          <ConfirmPasswordField id="npw2" value={confirm} onChange={(v) => { setConfirm(v); setErr((e) => ({ ...e, confirm: undefined })); }} original={pw} error={err.confirm} />
        </div>
      </Sheet>
    </>
  );
}

function PrivacySection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="text-sm muted flex gap-2"><ShieldCheck size={18} className="shrink-0 text-gain" /> Your records are stored on this device and, when signed in, in your own private cloud database where only you can read them. Pera has no ads and no analytics, and never sells your data.</p>
      <button className="btn-soft btn-sm" onClick={() => setOpen(true)}>Read the Privacy Policy</button>
      <PrivacySheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
