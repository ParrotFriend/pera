import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Trash2, Repeat } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Sheet, Field, MoneyInput, Segmented, useToast, useConfirm } from './ui.jsx';
import { IconTile } from './Icon.jsx';
import { useAccounts, useBalances, useCategories } from '../hooks/useData.js';
import { useApp } from '../services/app.jsx';
import * as L from '../services/ledger.js';
import { budgetAlertsFor } from '../services/budgets.js';
import { budgetMessage } from '../services/calc.js';
import { toLocalDate, toLocalTime, addDays } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';

const TYPE_LABEL = { expense: 'Expense', income: 'Income', transfer: 'Transfer', refund: 'Refund', adjustment: 'Adjustment' };

function blank(type) {
  return { type, amount: null, account_id: '', to_account_id: '', category_id: '', direction: 'in', date: toLocalDate(), time: toLocalTime(), payee: '', notes: '', tagsText: '' };
}

export default function TransactionForm({ open, onClose, initialType = 'expense', editing = null, prefill = null }) {
  const { currency, online, user } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const accounts = useAccounts({ includeArchived: false }) || [];
  const cats = useCategories();
  const led = useBalances();
  const [f, setF] = useState(() => blank(initialType));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const pickedCategory = useRef(false);
  const amountRef = useRef(null);
  const navigate = useNavigate();

  // Initialise each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    pickedCategory.current = false;
    if (editing) {
      pickedCategory.current = true;
      setF({ ...blank(editing.type), ...editing, category_id: editing.category_id || '', to_account_id: editing.to_account_id || '', tagsText: (editing.tags || []).map((t) => `#${t}`).join(' ') });
      return;
    }
    const b = { ...blank(initialType), ...(prefill || {}) };
    setF(b);
    if (prefill?.account_id) return;
    L.lastUsedAccount(initialType).then((id) => {
      if (id && accounts.some((a) => a.id === id)) setF((x) => (x.account_id ? x : { ...x, account_id: id }));
      else if (accounts[0]) setF((x) => (x.account_id ? x : { ...x, account_id: accounts[0].id }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, initialType]);

  useEffect(() => {
    if (!open || !user || !['expense', 'income'].includes(f.type)) return setRecent([]);
    L.recentPayees(f.type).then(setRecent);
  }, [open, f.type, user]);

  // Smart category suggestion from payee (user can always override).
  useEffect(() => {
    if (!open || pickedCategory.current || !['expense', 'income'].includes(f.type) || f.payee.trim().length < 2) return;
    const t = setTimeout(() => L.suggestCategory(f.payee, f.type).then((id) => { if (id && !pickedCategory.current) setF((x) => ({ ...x, category_id: id })); }), 250);
    return () => clearTimeout(t);
  }, [f.payee, f.type, open]);

  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const setType = (type) => { setErrors({}); setF((x) => ({ ...x, type, category_id: type === x.type ? x.category_id : '' })); pickedCategory.current = false; };
  const categoryList = f.type === 'income' ? cats?.income : cats?.expense;
  const showCategory = ['expense', 'income', 'refund'].includes(f.type);
  const accCurrency = accounts.find((a) => a.id === f.account_id)?.currency || currency;

  async function submit(again = false) {
    setBusy(true);
    try {
      const tags = f.tagsText.split(/[\s,]+/).filter(Boolean);
      const input = { ...f, tags, category_id: f.category_id || null, to_account_id: f.to_account_id || null };
      const saved = await L.saveTransaction(input, editing?.id || null);
      const label = TYPE_LABEL[f.type];
      budgetAlertsFor(saved).then((alerts) => alerts.forEach(({ budget, status }) =>
        toast(budgetMessage(budget, status, (v) => formatMoney(v, currency)), { tone: status.level === 'warning' ? 'info' : 'error', duration: 6000 }))).catch(() => {});
      toast(online || user?.local ? `${label} ${editing ? 'updated' : 'saved'}` : "You're offline. Saved on this device — it will sync automatically.", { tone: online || user?.local ? 'success' : 'info', duration: online ? 2500 : 5000 });
      if (again) {
        setF((x) => ({ ...blank(x.type), account_id: x.account_id, date: x.date }));
        pickedCategory.current = false;
        amountRef.current?.focus();
      } else onClose();
    } catch (e) {
      if (e instanceof L.ValidationError) setErrors(e.fields);
      else toast('Something went wrong. Your data is safe. Please try again.', { tone: 'error' });
    } finally { setBusy(false); }
  }

  async function remove() {
    const ok = await confirm({ title: 'Delete this transaction?', message: 'It moves to Trash and your balances update. You can restore it from Trash.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await L.deleteTransaction(editing.id);
    onClose();
    toast('Moved to Trash', { action: { label: 'Undo', onClick: () => L.restoreTransaction(editing.id) } });
  }

  const title = editing ? `Edit ${TYPE_LABEL[f.type].toLowerCase()}` : 'New transaction';
  const balanceOf = (id) => led?.balances.get(id) ?? 0;

  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={
        <div className="flex gap-2">
          {editing && <button className="icon-btn text-loss" onClick={remove} aria-label="Delete transaction"><Trash2 size={20} /></button>}
          {editing && !editing.schedule_id && ['expense', 'income', 'transfer'].includes(editing.type) && (
            <button className="icon-btn" onClick={() => { onClose(); navigate(`/bills?from=${editing.id}`); }} aria-label="Ulitin ito (make recurring)" title="Ulitin ito"><Repeat size={20} /></button>
          )}
          {!editing && <button className="btn-soft flex-1" disabled={busy} onClick={() => submit(true)}>Save & add another</button>}
          <button className={`${f.type === 'income' ? 'btn-gain' : 'btn-primary'} flex-1`} disabled={busy} onClick={() => submit(false)}>
            {editing ? 'Save changes' : `Save ${TYPE_LABEL[f.type].toLowerCase()}`}
          </button>
        </div>
      }>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        {['expense', 'income', 'transfer'].includes(f.type) && !(editing && editing.type === 'adjustment') ? (
          <Segmented label="Transaction type" value={f.type} onChange={setType} options={[['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']]} />
        ) : (
          <div className="flex items-center justify-between rounded-xl bg-ink-50 dark:bg-night px-3.5 py-2.5 text-sm">
            <span className="font-semibold">{TYPE_LABEL[f.type]}</span>
            {!editing && <button type="button" className="text-ink-400 underline" onClick={() => setType('expense')}>Back to expense</button>}
          </div>
        )}

        <Field error={errors.amount}>
          <MoneyInput ref={amountRef} large value={f.amount} onChange={set('amount')} currency={accCurrency} error={errors.amount} aria-label="Amount" data-autofocus={!editing || undefined} />
        </Field>

        {f.type === 'adjustment' && (
          <Field label="Balance goes" error={errors.direction}>
            <Segmented label="Direction" value={f.direction} onChange={set('direction')} options={[['in', 'Up'], ['out', 'Down']]} />
          </Field>
        )}

        {f.type !== 'transfer' && f.type !== 'adjustment' && (
          <Field label={f.type === 'income' ? 'From (payer)' : f.type === 'refund' ? 'Refunded by' : 'Where / merchant'} htmlFor="payee" error={errors.payee}>
            <input id="payee" className="input" value={f.payee} onChange={set('payee')} placeholder={f.type === 'income' ? 'e.g. Employer, client' : 'e.g. Jollibee, Shell, Netflix'} autoComplete="off" />
            {recent.length > 0 && !f.payee && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2">
                {recent.map((p) => <button type="button" key={p} className="chip shrink-0" onClick={() => set('payee')(p)}>{p}</button>)}
              </div>
            )}
          </Field>
        )}

        {showCategory && (
          <Field label={f.type === 'refund' ? 'Refund for category (optional)' : 'Category'} error={errors.category_id}>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
              {(categoryList || []).filter((c) => !c.parent_id || true).map((c) => {
                const on = f.category_id === c.id;
                return (
                  <button type="button" key={c.id} onClick={() => { pickedCategory.current = true; set('category_id')(on && f.type === 'refund' ? '' : c.id); }}
                    aria-pressed={on}
                    className={`flex flex-col items-center gap-1 rounded-xl p-2 text-[11.5px] leading-tight border transition-colors ${on ? 'border-ink bg-ink-50 dark:border-white dark:bg-night-line' : 'border-transparent hover:bg-ink-50 dark:hover:bg-night-line'}`}>
                    <IconTile name={c.icon} color={c.color} size={36} icon={17} />
                    <span className="line-clamp-2 text-center">{cats.label(c.id).replace(' › ', '›')}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label={f.type === 'transfer' ? 'From account' : f.type === 'income' || f.type === 'refund' ? 'Into account' : 'Paid from'} error={errors.account_id}>
          <AccountPicker accounts={accounts} value={f.account_id} onChange={set('account_id')} balanceOf={balanceOf} />
        </Field>

        {f.type === 'transfer' && (
          <>
            <div className="flex justify-center -my-2 muted"><ArrowLeftRight size={18} className="rotate-90" aria-hidden /></div>
            <Field label="To account" error={errors.to_account_id} hint="Transfers move money between your accounts. They are not counted as income or expense.">
              <AccountPicker accounts={accounts.filter((a) => a.id !== f.account_id)} value={f.to_account_id} onChange={set('to_account_id')} balanceOf={balanceOf} />
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="date" error={errors.date}>
            <input id="date" type="date" className={`input ${errors.date ? 'input-error' : ''}`} value={f.date} onChange={set('date')} />
          </Field>
          <Field label="Time" htmlFor="time" error={errors.time}>
            <input id="time" type="time" className="input" value={f.time} onChange={set('time')} />
          </Field>
        </div>
        {!editing && (
          <div className="flex gap-2 -mt-2">
            {[[toLocalDate(), 'Today'], [addDays(toLocalDate(), -1), 'Yesterday']].map(([d, l]) => (
              <button type="button" key={l} className={`chip ${f.date === d ? 'chip-on' : ''}`} onClick={() => set('date')(d)}>{l}</button>
            ))}
          </div>
        )}

        <Field label="Notes" htmlFor="notes" error={errors.notes}>
          <textarea id="notes" rows={2} className="input h-auto py-2.5" value={f.notes} onChange={set('notes')} placeholder="Optional" />
        </Field>
        <Field label="Tags" htmlFor="tags" hint="Separate with spaces, e.g. #school #project">
          <input id="tags" className="input" value={f.tagsText} onChange={set('tagsText')} placeholder="#business" autoComplete="off" />
        </Field>

        {!editing && f.type === 'expense' && (
          <button type="button" className="text-sm muted underline underline-offset-2" onClick={() => setType('refund')}>Record a refund instead</button>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function AccountPicker({ accounts, value, onChange, balanceOf }) {
  if (!accounts.length) return <p className="text-sm muted">Add an account first in Accounts.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
      {accounts.map((a) => {
        const on = value === a.id;
        return (
          <button type="button" key={a.id} onClick={() => onChange(a.id)} aria-pressed={on}
            className={`shrink-0 min-w-[120px] rounded-xl border px-3 py-2 text-left transition-colors ${on ? 'border-ink bg-ink text-white dark:bg-white dark:text-ink dark:border-white' : 'border-ink-100 bg-white hover:border-ink-200 dark:bg-night dark:border-night-line'}`}>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: a.color }} />{a.name}</span>
            <span className={`block text-[12px] money mt-0.5 ${on ? 'opacity-80' : 'muted'}`}>{formatMoney(balanceOf(a.id), a.currency)}</span>
          </button>
        );
      })}
    </div>
  );
}
