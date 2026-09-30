import { useState } from 'react';
import { supabase } from '../services/remote.js';
import { useApp } from '../services/app.jsx';
import { Field } from '../components/ui.jsx';
import { Logo } from '../components/Logo.jsx';
import { WalletArt } from '../components/Illustrations.jsx';
import PasswordField, { ConfirmPasswordField, passwordProblems, problemText } from '../components/PasswordField.jsx';
import { PrivacySheet } from '../components/PrivacyPolicy.jsx';

const friendly = (e) => {
  if (!navigator.onLine) return "You're offline. Connect to the internet to continue.";
  const m = e?.message || '';
  if (/invalid login/i.test(m)) return 'That email and password don’t match. Try again or reset your password.';
  if (/already registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first — check your inbox for the link.';
  if (/weak|should contain|at least|characters/i.test(m)) return 'That password is too weak. Follow the checklist below the password field.';
  if (/same.*password|different from the old/i.test(m)) return 'Use a password different from your old one.';
  if (/expired|invalid.*(token|link)|otp/i.test(m)) return 'This reset link has expired. Request a new one.';
  return 'Something went wrong. Please try again.';
};

export default function Auth() {
  const { auth } = useApp();
  const [mode, setMode] = useState(auth.recovery ? 'recover' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agree, setAgree] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const isNew = mode === 'signup' || mode === 'recover'; // creating a new password

  function go(next) { setMode(next); setMsg(null); setErr({}); setPassword(''); setConfirm(''); }

  async function submit(e) {
    e.preventDefault();
    const f = {};
    if (mode !== 'recover' && !/^\S+@\S+\.\S+$/.test(email.trim())) f.email = 'Enter a valid email address.';
    if (mode === 'signin' && !password) f.password = 'Enter your password.';
    if (isNew) {
      const problems = passwordProblems(password);
      if (problems.length) f.password = problemText(problems);
      if (!confirm) f.confirm = 'Type the password again.';
      else if (confirm !== password) f.confirm = 'The two passwords don’t match.';
    }
    if (mode === 'signup' && !agree) f.agree = 'Please read and agree to the Privacy Policy.';
    setErr(f); setMsg(null);
    if (Object.keys(f).length) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: import.meta.env.VITE_APP_URL || location.origin } });
        if (error) throw error;
        if (!data.session) setMsg({ tone: 'ok', text: 'Check your email to confirm your account, then sign in.' });
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: import.meta.env.VITE_APP_URL || location.origin });
        if (error) throw error;
        setMsg({ tone: 'ok', text: 'If that email has an account, a reset link is on its way. Check your inbox and spam folder.' });
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
        <button type="button" className="text-white/50 text-sm text-left underline underline-offset-2" onClick={() => setPrivacyOpen(true)}>Your data is private to your account. Privacy Policy</button>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate>
          <div className="lg:hidden mb-8"><Logo /></div>
          <div>
            <h1 className="text-3xl font-semibold">{titles[mode]}</h1>
            {mode === 'recover' && <p className="muted text-sm mt-1">Choose a new password for your account.</p>}
            {mode === 'forgot' && <p className="muted text-sm mt-1">We'll email you a link to set a new password.</p>}
          </div>
          {mode !== 'recover' && (
            <Field label="Email" htmlFor="email" error={err.email}>
              <input id="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" className={`input ${err.email ? 'input-error' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}
          {mode !== 'forgot' && (
            <PasswordField id="password" label={mode === 'recover' ? 'New password' : 'Password'} value={password} onChange={setPassword}
              autoComplete={isNew ? 'new-password' : 'current-password'} error={err.password} showRules={isNew} />
          )}
          {isNew && <ConfirmPasswordField id="confirm" value={confirm} onChange={setConfirm} original={password} error={err.confirm} />}
          {mode === 'signup' && (
            <div>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="h-5 w-5 mt-0.5 accent-ink" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={!!err.agree} />
                <span>I have read and agree to the <button type="button" className="underline underline-offset-2 font-medium" onClick={() => setPrivacyOpen(true)}>Privacy Policy</button>, including how my data is stored.</span>
              </label>
              {err.agree && <p className="field-error" role="alert">{err.agree}</p>}
            </div>
          )}
          {msg && <p role="alert" className={`text-sm rounded-xl px-3.5 py-2.5 ${msg.tone === 'ok' ? 'bg-gain-soft text-ink dark:bg-gain/15 dark:text-slate-100' : 'bg-loss-soft text-ink dark:bg-loss/15 dark:text-slate-100'}`}>{msg.text}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {{ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recover: 'Save new password' }[mode]}
          </button>
          <div className="flex justify-between text-sm">
            {mode === 'signin' ? <>
              <button type="button" className="underline underline-offset-2" onClick={() => go('signup')}>Create an account</button>
              <button type="button" className="muted underline underline-offset-2" onClick={() => go('forgot')}>Forgot password?</button>
            </> : mode !== 'recover' && <button type="button" className="underline underline-offset-2" onClick={() => go('signin')}>Back to sign in</button>}
          </div>
          <p className="lg:hidden text-center"><button type="button" className="text-[13px] muted underline underline-offset-2" onClick={() => setPrivacyOpen(true)}>Privacy Policy</button></p>
        </form>
      </div>
      <PrivacySheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}