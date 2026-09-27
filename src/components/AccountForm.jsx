import { useEffect, useState } from 'react';
import { Sheet, Field, MoneyInput, useToast } from './ui.jsx';
import Icon from './Icon.jsx';
import * as L from '../services/ledger.js';
import { ACCOUNT_TYPES, ACCOUNT_COLORS, ACCOUNT_PRESETS, isLiabilityType } from '../services/defaults.js';
import { useApp } from '../services/app.jsx';
import { CURRENCIES } from '../lib/money.js';

export default function AccountForm({ open, onClose, editing = null, onSaved }) {
  const { currency } = useApp();
  const toast = useToast();
  const blank = { name: '', type: 'cash', initial_balance: null, currency, color: ACCOUNT_COLORS[1], description: '', low_balance_threshold: null, include_in_total: true };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    // liabilities are stored as negative balances; the form asks for "amount owed" as a positive number
    setF(editing ? { ...editing, initial_balance: isLiabilityType(editing.type) ? -editing.initial_balance : editing.initial_balance } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const liability = isLiabilityType(f.type);

  async function save() {
    try {
      const input = { ...f, initial_balance: liability ? -(f.initial_balance ?? 0) : f.initial_balance ?? 0 };
      const saved = await L.saveAccount(input, editing?.id);
      toast(editing ? 'Account updated' : `${saved.name} added`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof L.ValidationError) setErrors(e.fields);
      else toast('Something went wrong. Your data is safe. Please try again.', { tone: 'error' });
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit account' : 'New account'}
      footer={<button className="btn-primary w-full" onClick={save}>{editing ? 'Save changes' : 'Add account'}</button>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_PRESETS.map(([name, type, color]) => (
              <button type="button" key={name} className={`chip ${f.name === name ? 'chip-on' : ''}`} onClick={() => setF((x) => ({ ...x, name, type, color }))}>{name}</button>
            ))}
          </div>
        )}
        <Field label="Account name" htmlFor="a-name" error={errors.name}>
          <input id="a-name" data-autofocus className={`input ${errors.name ? 'input-error' : ''}`} value={f.name} onChange={set('name')} placeholder="e.g. GCash, BPI Savings" />
        </Field>
        <Field label="Type" error={errors.type}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ACCOUNT_TYPES.map((t) => (
              <button type="button" key={t.value} onClick={() => set('type')(t.value)} aria-pressed={f.type === t.value}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium ${f.type === t.value ? 'border-ink bg-ink-50 dark:border-white dark:bg-night-line' : 'border-ink-100 dark:border-night-line'}`}>
                <Icon name={t.icon} size={16} /> {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={liability ? (editing ? 'Amount owed when you started tracking' : 'How much do you owe right now?') : editing ? 'Starting balance' : 'What is your starting balance?'} error={errors.initial_balance}
          hint={editing ? 'Changing this shifts the whole history of this account. To match a real balance today, use Reconcile instead.' : liability ? 'Enter 0 if nothing is owed yet.' : 'The amount in this account today, before new transactions.'}>
          <MoneyInput value={f.initial_balance} onChange={set('initial_balance')} currency={f.currency} allowNegative={!liability} error={errors.initial_balance} />
        </Field>
        {!editing && (
          <Field label="Currency" htmlFor="a-cur">
            <select id="a-cur" className="input" value={f.currency} onChange={set('currency')}>
              {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => set('color')(c)} aria-label={`Color ${c}`} aria-pressed={f.color === c}
                className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-night-card ${f.color === c ? 'ring-2 ring-ink dark:ring-white' : ''}`} style={{ background: c }} />
            ))}
          </div>
        </Field>
        {!liability && (
          <Field label="Low balance alert (optional)" error={errors.low_balance_threshold} hint="Show a warning when this account drops below this amount.">
            <MoneyInput value={f.low_balance_threshold} onChange={set('low_balance_threshold')} currency={f.currency} />
          </Field>
        )}
        <Field label="Description (optional)" htmlFor="a-desc">
          <input id="a-desc" className="input" value={f.description} onChange={set('description')} />
        </Field>
        {!liability && (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-ink" checked={f.include_in_total !== false} onChange={set('include_in_total')} />
            Include in total balance
          </label>
        )}
      </form>
    </Sheet>
  );
}
