import { useState } from 'react';
import { supabase } from '../services/remote.js';
import { useApp } from '../services/app.jsx';
import { Field } from '../components/ui.jsx';
import { Logo } from '../components/Logo.jsx';
import { WalletArt } from '../components/Illustrations.jsx';

const friendly = (e) => {
  if (!navigator.onLine) return "You're offline. Connect to the internet to sign in.";
  const m = e?.message || '';
  if (/invalid login/i.test(m)) return 'That email and password don’t match. Try again or reset your password.';
  if (/already registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first — check your inbox for the link.';
  return 'Something went wrong. Please try again.';
};

export default function Auth() {
  const { auth } = useApp();
  const [mode, setMode] = useState(auth.recovery ? 'recover' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const f = {};
    if (mode !== 'recover' && !/^\S+@\S+\.\S+$/.test(email)) f.email = 'Enter a valid email address.';
    if (mode !== 'forgot' && password.length < 8) f.password = 'Use at least 8 characters.';
    setErr(f); setMsg(null);
    if (Object.keys(f).length) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: import.meta.env.VITE_APP_URL || location.origin } });
        if (error) throw error;
        if (!data.session) setMsg({ tone: 'ok', text: 'Check your email to confirm your account, then sign in.' });
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: import.meta.env.VITE_APP_URL || location.origin });
        if (error) throw error;
        setMsg({ tone: 'ok', text: 'If that email has an account, a reset link is on its way.' });
      } else if (mode === 'recover') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMsg({ tone: 'ok', text: 'Password updated. You are signed in.' });
      }
    } catch (e2) { setMsg({ tone: 'err', text: friendly(e2) }); } finally { setBusy(false); }
  }

  const titles = { signin: 'Welcome back', signup: 'Create your account', forgot: 'Reset your password', recover: 'Set a new password' };
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-ink text-white p-12">
        <Logo />
        <div>
          <WalletArt className="w-64 h-52 -ml-4" />
          <h2 className="text-4xl font-semibold mt-6 max-w-md leading-tight">Know where every peso is.</h2>
          <p className="text-white/60 mt-3 max-w-md">Accounts, income, expenses and transfers in one place. Works without internet and syncs when you're back online.</p>
        </div>
        <p className="text-white/40 text-sm">Your data is private to your account.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate>
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-3xl font-semibold">{titles[mode]}</h1>
          {mode !== 'recover' && (
            <Field label="Email" htmlFor="email" error={err.email}>
              <input id="email" type="email" autoComplete="email" className={`input ${err.email ? 'input-error' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}
          {mode !== 'forgot' && (
            <Field label={mode === 'recover' ? 'New password' : 'Password'} htmlFor="password" error={err.password}>
              <input id="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} className={`input ${err.password ? 'input-error' : ''}`} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {msg && <p role="alert" className={`text-sm rounded-xl px-3.5 py-2.5 ${msg.tone === 'ok' ? 'bg-gain-soft text-ink dark:bg-gain/15 dark:text-slate-100' : 'bg-loss-soft text-ink dark:bg-loss/15 dark:text-slate-100'}`}>{msg.text}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {{ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recover: 'Save new password' }[mode]}
          </button>
          <div className="flex justify-between text-sm">
            {mode === 'signin' ? <>
              <button type="button" className="underline underline-offset-2" onClick={() => { setMode('signup'); setMsg(null); }}>Create an account</button>
              <button type="button" className="muted underline underline-offset-2" onClick={() => { setMode('forgot'); setMsg(null); }}>Forgot password?</button>
            </> : mode !== 'recover' && <button type="button" className="underline underline-offset-2" onClick={() => { setMode('signin'); setMsg(null); }}>Back to sign in</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
