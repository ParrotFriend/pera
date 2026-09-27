import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, RotateCw } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { useBudgets, useCategories, useLedger } from '../hooks/useData.js';
import { PageHeader, Sheet, Field, MoneyInput, Segmented, useToast, useConfirm } from '../components/ui.jsx';
import { IconTile } from '../components/Icon.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import { budgetStatus, budgetMessage } from '../services/calc.js';
import * as B from '../services/budgets.js';
import { ValidationError } from '../services/ledger.js';
import { formatMoney } from '../lib/money.js';
import { toLocalDate, parseLocalDate, monthLabel } from '../lib/dates.js';

export const LEVEL_TONE = { ok: 'gain', warning: 'warn', reached: 'warn', exceeded: 'loss' };
const LEVEL_TEXT = { ok: 'On track', warning: 'Almost used up', reached: 'Budget reached', exceeded: 'Over budget' };
const periodText = (b, st) => b.period === 'weekly'
  ? `This week · ${parseLocalDate(st.period.from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${parseLocalDate(st.period.to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  : b.period === 'custom' ? `${st.period.from} to ${st.period.to}` : monthLabel(st.period.from);

/** Compute status for every budget (shared with the dashboard). */
export function useBudgetStatuses() {
  const budgets = useBudgets();
  const txs = useLedger();
  const cats = useCategories();
  return useMemo(() => {
    if (!budgets || !txs || !cats) return undefined;
    const today = toLocalDate();
    return budgets.filter((b) => !b.archived_at && !(b.period === 'custom' && b.end_date < today))
      .map((b) => ({ budget: b, st: budgetStatus(b, txs, cats.all, today) }))
      .sort((a, b) => b.st.pct - a.st.pct);
  }, [budgets, txs, cats]);
}

export function BudgetCard({ budget, st, cats, currency, onClick, compact = false }) {
  const tone = LEVEL_TONE[st.level];
  const first = cats?.byId.get(budget.category_ids?.[0]);
  const bar = { gain: 'bg-gain', warn: 'bg-warn', loss: 'bg-loss' }[tone];
  const text = { gain: 'text-gain dark:text-gain-dark', warn: 'text-warn', loss: 'text-loss dark:text-loss-dark' }[tone];
  const fmt = (v) => formatMoney(v, currency);
  return (
    <button onClick={onClick} className={`w-full text-left ${compact ? 'py-2.5' : 'card p-4 hover:border-ink-200 dark:hover:border-ink-600'} transition-colors`}>
      <div className="flex items-center gap-3">
        {budget.scope === 'category'
          ? <IconTile name={first?.icon} color={first?.color} size={compact ? 32 : 40} icon={compact ? 16 : 18} />
          : <span className={`inline-flex items-center justify-center rounded-xl bg-ink text-white dark:bg-white dark:text-ink font-display font-bold ${compact ? 'h-8 w-8 text-sm' : 'h-10 w-10'}`}>₱</span>}
        <span className="flex-1 min-w-0">
          <span className="block font-medium truncate">{budget.name}</span>
          {!compact && <span className="block text-[12.5px] muted truncate">{periodText(budget, st)}{budget.scope === 'category' && budget.category_ids.length > 1 ? ` · ${budget.category_ids.length} categories` : ''}</span>}
        </span>
        <span className="text-right">
          <span className="block money font-semibold">{fmt(st.spent)} <span className="muted font-normal text-[13px]">/ {fmt(st.limit)}</span></span>
          <span className={`block text-[12px] font-medium ${text}`}>{LEVEL_TEXT[st.level]} · {Math.round(st.pct)}%</span>
        </span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-ink-50 dark:bg-night-line overflow-hidden" role="progressbar" aria-valuenow={Math.round(Math.min(st.pct, 100))} aria-valuemin={0} aria-valuemax={100} aria-label={`${budget.name} budget used`}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, st.pct)}%` }} />
      </div>
      {!compact && (
        <p className={`mt-2 text-[13px] ${st.level === 'ok' ? 'muted' : text}`}>
          {budgetMessage(budget, st, fmt)}
          {st.carried > 0 && <span className="muted"> Includes {fmt(st.carried)} rolled over.</span>}
        </p>
      )}
    </button>
  );
}

export default function Budgets() {
  const { currency } = useApp();
  const statuses = useBudgetStatuses();
  const cats = useCategories();
  const [form, setForm] = useState(null);
  if (!statuses || !cats) return <div className="skeleton h-64" />;
  const monthly = statuses.filter((x) => x.budget.period === 'monthly');
  const overall = monthly.find((x) => x.budget.scope === 'overall');
  const catSum = monthly.filter((x) => x.budget.scope === 'category');
  const limit = overall ? overall.st.limit : catSum.reduce((s, x) => s + x.st.limit, 0);
  const spent = overall ? overall.st.spent : catSum.reduce((s, x) => s + x.st.spent, 0);

  return (
    <div>
      <PageHeader title="Budgets" subtitle="How much you can still spend" actions={<button className="btn-primary btn-sm" onClick={() => setForm({})}><Plus size={16} /> Add budget</button>} />
      {!statuses.length ? (
        <div className="card"><EmptyState art="chart" title="Set your first budget" body="Pick a monthly limit for everything or for categories like Food. Pera warns you before you go over."
          action={<button className="btn-primary" onClick={() => setForm({})}><Plus size={18} /> Add budget</button>} /></div>
      ) : (
        <div className="space-y-5">
          {limit > 0 && (
            <section className="rounded-3xl bg-ink text-white dark:bg-[#18214A] p-5 sm:p-6" aria-label="This month">
              <p className="text-white/60 text-sm">{overall ? 'Left in your monthly budget' : 'Left across your monthly budgets'}</p>
              <p className={`money text-4xl font-semibold mt-1 ${limit - spent < 0 ? 'text-loss-dark' : ''}`}>{formatMoney(limit - spent, currency)}</p>
              <p className="text-white/60 text-sm mt-1">{formatMoney(spent, currency)} spent of {formatMoney(limit, currency)} · {monthLabel(toLocalDate())}</p>
            </section>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {statuses.map(({ budget, st }) => <BudgetCard key={budget.id} budget={budget} st={st} cats={cats} currency={currency} onClick={() => setForm(budget)} />)}
          </div>
        </div>
      )}
      <BudgetForm value={form} onClose={() => setForm(null)} />
    </div>
  );
}

function BudgetForm({ value, onClose }) {
  const { currency } = useApp();
  const cats = useCategories();
  const toast = useToast();
  const confirm = useConfirm();
  const editing = value?.id ? value : null;
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (!value) return;
    setErrors({});
    setF(editing ? { ...editing } : { name: '', scope: 'category', category_ids: [], amount: null, period: 'monthly', start_date: toLocalDate(), end_date: '', rollover: false, alert_at: 80 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value || !f || !cats) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const toggleCat = (id) => setF((x) => {
    const ids = x.category_ids.includes(id) ? x.category_ids.filter((c) => c !== id) : [...x.category_ids, id];
    const autoName = !x.name || x.name === cats.label(x.category_ids[0]) || x.name === x._auto;
    const name = autoName && ids.length === 1 ? cats.byId.get(ids[0]).name : autoName && ids.length > 1 ? `${cats.byId.get(ids[0]).name} + ${ids.length - 1}` : x.name;
    return { ...x, category_ids: ids, name, _auto: name };
  });
  async function save() {
    try {
      await B.saveBudget({ ...f, name: f.name || (f.scope === 'overall' ? 'Monthly spending' : '') }, editing?.id);
      toast(editing ? 'Budget updated' : 'Budget added');
      onClose();
    } catch (e) { if (e instanceof ValidationError) setErrors(e.fields); else toast('Something went wrong. Please try again.', { tone: 'error' }); }
  }
  async function remove() {
    if (!(await confirm({ title: `Delete ${editing.name}?`, message: 'Only the budget is removed. Your transactions stay as they are.', confirmLabel: 'Delete', danger: true }))) return;
    await B.deleteBudget(editing.id);
    toast('Budget deleted');
    onClose();
  }
  const parents = cats.expense.filter((c) => !c.parent_id);
  return (
    <Sheet open onClose={onClose} title={editing ? 'Edit budget' : 'New budget'}
      footer={<div className="flex gap-2">
        {editing && <button className="icon-btn text-loss" onClick={remove} aria-label="Delete budget"><Trash2 size={20} /></button>}
        <button className="btn-primary flex-1" onClick={save}>{editing ? 'Save changes' : 'Add budget'}</button>
      </div>}>
      <div className="space-y-5">
        <Field label="Covers" error={errors.scope}>
          <Segmented label="Budget covers" value={f.scope} onChange={set('scope')} options={[['category', 'Categories'], ['overall', 'All spending']]} />
        </Field>
        {f.scope === 'category' && (
          <Field label="Categories" error={errors.category_ids} hint="Subcategories are included automatically.">
            <div className="flex flex-wrap gap-2">
              {parents.map((c) => <button type="button" key={c.id} onClick={() => toggleCat(c.id)} aria-pressed={f.category_ids.includes(c.id)} className={`chip ${f.category_ids.includes(c.id) ? 'chip-on' : ''}`}>{c.name}</button>)}
            </div>
          </Field>
        )}
        <Field label="Name" htmlFor="b-name" error={errors.name}>
          <input id="b-name" className={`input ${errors.name ? 'input-error' : ''}`} value={f.name} onChange={set('name')} placeholder={f.scope === 'overall' ? 'Monthly spending' : 'e.g. Food'} />
        </Field>
        <Field label="Amount" error={errors.amount}>
          <MoneyInput value={f.amount} onChange={set('amount')} currency={currency} error={errors.amount} aria-label="Budget amount" />
        </Field>
        <Field label="Period" error={errors.period}>
          <Segmented label="Period" value={f.period} onChange={set('period')} options={[['monthly', 'Monthly'], ['weekly', 'Weekly'], ['custom', 'Custom']]} />
        </Field>
        {f.period === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="b-from" error={errors.start_date}><input id="b-from" type="date" className="input" value={f.start_date} onChange={set('start_date')} /></Field>
            <Field label="To" htmlFor="b-to" error={errors.end_date}><input id="b-to" type="date" className="input" value={f.end_date || ''} onChange={set('end_date')} /></Field>
          </div>
        )}
        <Field label="Warn me when I've used" htmlFor="b-alert" error={errors.alert_at}>
          <div className="flex items-center gap-2">
            <input id="b-alert" type="number" min="1" max="100" inputMode="numeric" className="input w-24" value={f.alert_at} onChange={set('alert_at')} />
            <span className="muted text-sm">% of the budget. You'll also be told when it's reached and when it's exceeded.</span>
          </div>
        </Field>
        {f.period !== 'custom' && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 mt-0.5 accent-ink" checked={!!f.rollover} onChange={set('rollover')} />
            <span><span className="font-medium flex items-center gap-1.5"><RotateCw size={14} /> Roll over unused money</span>
              <span className="muted block">If you spend less this {f.period === 'weekly' ? 'week' : 'month'}, the rest is added to the next one.</span></span>
          </label>
        )}
        {editing && editing.scope === 'category' && editing.category_ids.length === 1 && (
          <Link to={`/transactions?category=${editing.category_ids[0]}`} className="text-sm underline underline-offset-2" onClick={onClose}>See {editing.name} transactions</Link>
        )}
      </div>
    </Sheet>
  );
}
