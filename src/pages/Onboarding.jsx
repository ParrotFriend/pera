import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { MoneyInput } from '../components/ui.jsx';
import { Logo } from '../components/Logo.jsx';
import { WalletArt } from '../components/Illustrations.jsx';
import * as L from '../services/ledger.js';
import { ACCOUNT_PRESETS } from '../services/defaults.js';
import { CURRENCIES, formatMoney } from '../lib/money.js';

export default function Onboarding() {
  const { settings, updateSettings } = useApp();
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState(settings?.currency || 'PHP');
  const [picked, setPicked] = useState({ Cash: null });
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const finish = () => updateSettings({ currency, onboarded: true });

  async function createAccounts() {
    setSaving(true);
    try {
      await updateSettings({ currency });
      for (const [name, bal] of Object.entries(picked)) {
        const preset = ACCOUNT_PRESETS.find((p) => p[0] === name);
        await L.saveAccount({ name, type: preset?.[1] || 'other', color: preset?.[2] || '#141B3C', initial_balance: bal ?? 0, currency });
      }
      setStep(3);
    } finally { setSaving(false); }
  }
  const total = Object.values(picked).reduce((s, v) => s + (v || 0), 0);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-5">
        <Logo small />
        {step < 3 && <button className="btn-ghost btn-sm" onClick={finish}>Skip setup</button>}
      </header>
      <div className="px-5"><div className="mx-auto max-w-md flex gap-1.5" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-ink dark:bg-white' : 'bg-ink-100 dark:bg-night-line'}`} />)}</div></div>
      <main className="flex-1 flex items-start sm:items-center justify-center p-5">
        <div className="w-full max-w-md">
          {step === 0 && (
            <div className="text-center">
              <WalletArt className="w-56 h-44 mx-auto" />
              <h1 className="text-3xl font-semibold mt-4">Let's set up your money</h1>
              <p className="muted mt-2">Two quick steps: your currency and where your money is right now. You can change everything later.</p>
              <button className="btn-primary w-full mt-8" onClick={() => setStep(1)}>Get started</button>
            </div>
          )}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-semibold">Which currency do you use?</h1>
              <div className="mt-5 space-y-2" role="radiogroup" aria-label="Currency">
                {Object.values(CURRENCIES).map((c) => (
                  <button key={c.code} role="radio" aria-checked={currency === c.code} onClick={() => setCurrency(c.code)}
                    className={`w-full flex items-center gap-3 rounded-2xl border px-4 h-14 text-left ${currency === c.code ? 'border-ink bg-white dark:bg-night-card dark:border-white' : 'border-ink-100 dark:border-night-line'}`}>
                    <span className="font-display text-xl w-8">{c.symbol}</span><span className="flex-1 font-medium">{c.name}</span>{currency === c.code && <Check size={18} />}
                  </button>
                ))}
              </div>
              <button className="btn-primary w-full mt-6" onClick={() => setStep(2)}>Continue</button>
            </div>
          )}
          {step === 2 && (
            <div>
              <h1 className="text-2xl font-semibold">Where is your money right now?</h1>
              <p className="muted mt-1 text-sm">Pick your accounts and enter today's balance for each.</p>
              <div className="flex flex-wrap gap-2 mt-4">
                {ACCOUNT_PRESETS.map(([name]) => {
                  const on = name in picked;
                  return <button key={name} className={`chip ${on ? 'chip-on' : ''}`} aria-pressed={on} onClick={() => setPicked((p) => { const n = { ...p }; if (on) delete n[name]; else n[name] = null; return n; })}>{on && <Check size={14} />}{name}</button>;
                })}
              </div>
              <div className="flex gap-2 mt-3">
                <input className="input" placeholder="Other account name" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Other account name" />
                <button className="btn-soft" disabled={!custom.trim()} onClick={() => { setPicked((p) => ({ ...p, [custom.trim()]: null })); setCustom(''); }}><Plus size={16} /> Add</button>
              </div>
              <div className="mt-5 space-y-3">
                {Object.keys(picked).map((name) => (
                  <label key={name} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 font-medium truncate">{name}</span>
                    <span className="flex-1"><MoneyInput value={picked[name]} onChange={(v) => setPicked((p) => ({ ...p, [name]: v }))} currency={currency} aria-label={`${name} starting balance`} /></span>
                  </label>
                ))}
              </div>
              {Object.keys(picked).length > 0 && <p className="mt-4 text-sm muted">Total: <span className="money font-semibold text-ink dark:text-white">{formatMoney(total, currency)}</span></p>}
              <button className="btn-primary w-full mt-6" disabled={!Object.keys(picked).length || saving} onClick={createAccounts}>Create {Object.keys(picked).length} account{Object.keys(picked).length === 1 ? '' : 's'}</button>
            </div>
          )}
          {step === 3 && (
            <div className="text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-gain text-white grid place-items-center"><Check size={32} /></div>
              <h1 className="text-3xl font-semibold mt-5">You're all set</h1>
              <p className="muted mt-2">Your total balance is <span className="money font-semibold text-ink dark:text-white">{formatMoney(total, currency)}</span>. Tap + anytime to record an expense.</p>
              <button className="btn-primary w-full mt-8" onClick={finish}>Go to dashboard</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
