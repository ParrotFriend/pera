import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Pause, Play, Pencil, Trash2, Check, SkipForward, Undo2, ChevronRight } from 'lucide-react';
import { db } from '../db/db.js';
import { useApp } from '../services/app.jsx';
import { useAccounts, useCategories } from '../hooks/useData.js';
import { PageHeader, Sheet, Field, MoneyInput, Segmented, useToast, useConfirm } from '../components/ui.jsx';
import { IconTile } from '../components/Icon.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import * as S from '../services/schedules.js';
import { ValidationError } from '../services/ledger.js';
import { formatMoney } from '../lib/money.js';
import { toLocalDate, addDays, friendlyDate, parseLocalDate } from '../lib/dates.js';

// ---------- shared helpers ----------
const STATE = {
  overdue: ['Overdue', 'bg-loss-soft text-loss dark:bg-loss/15 dark:text-loss-dark'],
  today: ['Due today', 'bg-warn-soft text-warn dark:bg-warn/15'],
  soon: ['Due soon', 'bg-info-soft text-info dark:bg-info/15'],
  upcoming: ['Upcoming', 'bg-ink-50 text-ink-600 dark:bg-night-line dark:text-slate-300'],
  paid: ['Paid ✓', 'bg-gain-soft text-gain dark:bg-gain/15 dark:text-gain-dark'],
  skipped: ['Skipped', 'bg-ink-50 text-ink-400 dark:bg-night-line dark:text-slate-400']
};
const Badge = ({ state }) => <span className={`inline-flex items-center rounded-full px-2 h-6 text-[11.5px] font-semibold whitespace-nowrap ${STATE[state][1]}`}>{STATE[state][0]}</span>;
const daysBetween = (a, b) => Math.round((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
function dueText(o, today) {
  if (!o) return 'No upcoming dates';
  const d = daysBetween(today, o.date);
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue · was due ${friendlyDate(o.date)}`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due ${friendlyDate(o.date)} · in ${d} days`;
}
export function frequencyText(s) {
  if (s.frequency === 'custom') return `Every ${s.interval} ${s.interval_unit}${s.interval > 1 ? 's' : ''}`;
  const day = parseLocalDate(s.start_date).getDate();
  if (s.frequency === 'monthly') return `Monthly · every ${day}${[, 'st', 'nd', 'rd'][day % 10 > 3 || [11, 12, 13].includes(day) ? 0 : day % 10] || 'th'}`;
  return S.FREQUENCIES.find(([v]) => v === s.frequency)?.[1] || s.frequency;
}

/** Live list of schedules with their computed summaries. */
export function useSchedules() {
  const { user } = useApp();
  return useLiveQuery(async () => {
    if (!user) return [];
    const [list, txs] = await Promise.all([
      db.schedules.where('user_id').equals(user.id).filter((s) => !s.deleted_at).toArray(),
      db.transactions.where('user_id').equals(user.id).filter((t) => !!t.schedule_id).toArray()
    ]);
    const txById = new Map(txs.map((t) => [t.id, t]));
    const today = toLocalDate();
    return Promise.all(list.map(async (s) => ({ s, sum: await S.scheduleSummary(s, txById, today) })));
  }, [user?.id]);
}

// ---------- page ----------
export default function Bills() {
  const { currency } = useApp();
  const rows = useSchedules();
  const cats = useCategories();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('bill');
  const [form, setForm] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [paying, setPaying] = useState(null);
  const today = toLocalDate();

  // "Ulitin ito" from a transaction: /bills?from=<transactionId>
  useEffect(() => {
    const from = params.get('from');
    if (!from) return;
    db.transactions.get(from).then((t) => {
      if (t) {
        setTab('recurring');
        setForm({ kind: 'recurring', type: t.type, amount: t.amount, account_id: t.account_id, to_account_id: t.to_account_id, category_id: t.category_id, name: t.payee || '', payee: t.payee, notes: t.notes, frequency: 'monthly', start_date: S.occurrenceAt({ frequency: 'monthly', start_date: t.date }, 1), auto: true });
      }
      params.delete('from'); setParams(params, { replace: true });
    });
  }, [params, setParams]);

  if (!rows || !cats) return <div className="skeleton h-64" />;
  const bills = rows.filter((r) => r.s.kind === 'bill').sort((a, b) => (a.sum.current?.date || '9999').localeCompare(b.sum.current?.date || '9999'));
  const recurring = rows.filter((r) => r.s.kind === 'recurring').sort((a, b) => (a.sum.next || '9999').localeCompare(b.sum.next || '9999'));
  const waiting = recurring.filter((r) => !r.s.auto && !r.s.paused_at && r.sum.current && ['overdue', 'today'].includes(r.sum.current.state));
  const monthEnd = `${today.slice(0, 8)}31`;
  const unpaid = bills.filter((r) => !r.s.paused_at).flatMap((r) => r.sum.all.filter((o) => ['overdue', 'today', 'soon', 'upcoming'].includes(o.state) && o.date <= monthEnd).map((o) => ({ o, s: r.s })));
  const unpaidTotal = unpaid.reduce((sum, x) => sum + (x.s.amount || 0), 0);
  const overdueCount = unpaid.filter((x) => x.o.state === 'overdue').length;
  const weekCount = unpaid.filter((x) => x.o.date >= today && x.o.date <= addDays(today, 7)).length;
  const open = openId ? rows.find((r) => r.s.id === openId) : null;

  return (
    <div>
      <PageHeader title="Bills" subtitle="Bills to pay and transactions that repeat" actions={<button className="btn-primary btn-sm" onClick={() => setForm({ kind: tab })}><Plus size={16} /> Add</button>} />
      <div className="max-w-sm"><Segmented label="Type" value={tab} onChange={setTab} options={[['bill', `Bills (${bills.length})`], ['recurring', `Auto (${recurring.length})`]]} /></div>

      {tab === 'bill' ? (
        <>
          {bills.length > 0 && (
            <section className="mt-4 rounded-3xl bg-ink text-white dark:bg-[#18214A] p-5 sm:p-6" aria-label="This month">
              <p className="text-white/60 text-sm">Unpaid bills until the end of this month</p>
              <p className="money text-4xl font-semibold mt-1">{formatMoney(unpaidTotal, currency)}{unpaid.some((x) => x.s.variable_amount) && <span className="text-base font-normal text-white/60"> + varying</span>}</p>
              <p className="text-white/60 text-sm mt-1">{unpaid.length} unpaid · {weekCount} due this week{overdueCount ? <> · <span className="text-loss-dark font-semibold">{overdueCount} overdue</span></> : null}</p>
            </section>
          )}
          <div className="mt-4 space-y-2.5">
            {!bills.length ? (
              <div className="card"><EmptyState art="receipt" title="No bills yet" body="Add rent, electricity, internet or tuition. Pera tracks when each is due and what's overdue." action={<button className="btn-primary" onClick={() => setForm({ kind: 'bill' })}><Plus size={18} /> Add bill</button>} /></div>
            ) : bills.map(({ s, sum }) => {
              const c = cats.byId.get(s.category_id);
              const cur = sum.current;
              return (
                <div key={s.id} className="card p-3.5 flex items-center gap-3">
                  <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => setOpenId(s.id)}>
                    <IconTile name={c?.icon} color={c?.color} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="font-medium truncate">{s.name}</span>{s.paused_at ? <span className="text-[11.5px] muted">Paused</span> : cur && <Badge state={cur.state} />}</span>
                      <span className="block text-[12.5px] muted truncate">{s.variable_amount ? 'Amount varies' : formatMoney(s.amount, currency)} · {s.paused_at ? frequencyText(s) : dueText(cur, today)}{sum.overdue.length > 1 ? ` · ${sum.overdue.length} overdue` : ''}</span>
                    </span>
                  </button>
                  {cur && !s.paused_at && <button className="btn-gain btn-sm shrink-0" onClick={() => setPaying({ s, date: cur.date })}><Check size={15} /> Bayad na</button>}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="mt-4 space-y-4">
          {waiting.length > 0 && (
            <section className="card p-4" aria-label="Waiting for you">
              <h2 className="text-sm font-semibold font-sans">Waiting for you</h2>
              {waiting.map(({ s, sum }) => (
                <div key={s.id} className="flex items-center gap-2 py-2.5 border-t first:border-0 border-ink-100/70 dark:border-night-line mt-2 first:mt-0">
                  <span className="flex-1 min-w-0"><span className="block font-medium truncate">{s.name} · {formatMoney(s.amount, currency)}</span><span className="block text-[12.5px] muted">{dueText(sum.current, today)}</span></span>
                  <button className="btn-soft btn-sm" onClick={() => S.skipOccurrence(s.id, sum.current.date)}>Skip</button>
                  <button className="btn-primary btn-sm" onClick={() => setPaying({ s, date: sum.current.date })}>Record</button>
                </div>
              ))}
            </section>
          )}
          {!recurring.length ? (
            <div className="card"><EmptyState art="chart" title="Nothing repeats yet" body="Salary, Netflix, allowance or a monthly savings transfer. Pera records them for you on schedule." action={<button className="btn-primary" onClick={() => setForm({ kind: 'recurring' })}><Plus size={18} /> Add recurring</button>} /></div>
          ) : (
            <div className="card p-1.5 sm:p-2">
              {recurring.map(({ s, sum }) => {
                const c = cats.byId.get(s.category_id);
                const sign = s.type === 'income' ? '+' : s.type === 'expense' ? '−' : '';
                return (
                  <button key={s.id} onClick={() => setOpenId(s.id)} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-ink-50/70 dark:hover:bg-night-line/60">
                    <IconTile name={s.type === 'transfer' ? 'repeat' : c?.icon} color={s.type === 'transfer' ? '#1C8FD1' : c?.color} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{s.name}</span>
                      <span className="block text-[12.5px] muted truncate">{frequencyText(s)} · {s.paused_at ? 'Paused' : sum.next ? `next ${friendlyDate(sum.next)}` : 'ended'} · {s.auto ? 'Auto' : 'Ask first'}</span>
                    </span>
                    <span className={`money font-semibold ${s.type === 'income' ? 'amount-in' : ''}`}>{sign}{formatMoney(s.amount, currency)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {open && !paying && <ScheduleSheet row={open} onClose={() => setOpenId(null)} onPay={(date) => setPaying({ s: open.s, date })} onEdit={() => { setForm(open.s); setOpenId(null); }} />}
      {paying && <PaySheet s={paying.s} date={paying.date} onClose={() => setPaying(null)} />}
      <ScheduleForm value={form} onClose={() => setForm(null)} />
    </div>
  );
}

// ---------- details ----------
function ScheduleSheet({ row, onClose, onPay, onEdit }) {
  const { currency } = useApp();
  const cats = useCategories();
  const accounts = useAccounts() || [];
  const toast = useToast();
  const confirm = useConfirm();
  const { s, sum } = row;
  const accName = (id) => accounts.find((a) => a.id === id)?.name || '—';
  const isBill = s.kind === 'bill';
  async function remove() {
    const ok = await confirm({ title: `Delete ${s.name}?`, message: 'No more dates will be created. Transactions already recorded stay in your history.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await S.deleteSchedule(s.id); onClose();
    toast('Deleted', { action: { label: 'Undo', onClick: () => S.restoreSchedule(s.id) } });
  }
  const items = [...(sum.current && !sum.history.some((h) => h.date === sum.current.date) ? [sum.current] : []), ...sum.history];
  return (
    <Sheet open onClose={onClose} title={s.name}>
      <div className="space-y-5">
        <div>
          <p className="money text-3xl font-semibold">{s.variable_amount ? 'Amount varies' : formatMoney(s.amount, currency)}</p>
          <p className="muted text-sm mt-1">{frequencyText(s)} · {s.type === 'transfer' ? `${accName(s.account_id)} → ${accName(s.to_account_id)}` : `${cats?.label(s.category_id)} · ${accName(s.account_id)}`}</p>
          <p className="text-sm mt-1">{s.paused_at ? 'Paused' : isBill ? dueText(sum.current, toLocalDate()) : sum.next ? `Next: ${friendlyDate(sum.next)} · ${s.auto ? 'recorded automatically' : 'asks you first'}` : 'No more dates'}</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-1 font-sans">History</h3>
          {!items.length ? <p className="text-sm muted">Nothing yet.</p> : (
            <ul className="divide-y divide-ink-100/70 dark:divide-night-line">
              {items.map((o) => (
                <li key={o.date} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex-1 min-w-0">
                    <span className="block">{friendlyDate(o.date)}</span>
                    {o.tx && <span className="block text-[12px] muted">{formatMoney(o.tx.amount, currency)}{o.tx.date !== o.date ? ` · paid ${friendlyDate(o.tx.date)}` : ''}</span>}
                  </span>
                  <Badge state={o.state} />
                  {o.state === 'paid' && <button className="icon-btn w-8 h-8" onClick={() => S.unpayOccurrence(s.id, o.date).then(() => toast('Payment undone'))} aria-label="Undo payment"><Undo2 size={15} /></button>}
                  {o.state === 'skipped' && <button className="icon-btn w-8 h-8" onClick={() => S.unskipOccurrence(s.id, o.date)} aria-label="Undo skip"><Undo2 size={15} /></button>}
                  {['overdue', 'today', 'soon', 'upcoming'].includes(o.state) && <>
                    <button className="icon-btn w-8 h-8" onClick={() => S.skipOccurrence(s.id, o.date).then(() => toast('Skipped'))} aria-label="Skip this date"><SkipForward size={15} /></button>
                    <button className="btn-gain btn-sm" onClick={() => onPay(o.date)}>{isBill ? 'Bayad na' : 'Record'}</button>
                  </>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-soft btn-sm" onClick={onEdit}><Pencil size={15} /> Edit</button>
          <button className="btn-soft btn-sm" onClick={() => S.setPaused(s.id, !s.paused_at).then(() => toast(s.paused_at ? 'Resumed' : 'Paused'))}>{s.paused_at ? <><Play size={15} /> Resume</> : <><Pause size={15} /> Pause</>}</button>
          <button className="btn-ghost btn-sm text-loss" onClick={remove}><Trash2 size={15} /> Delete</button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- pay / record one date ----------
function PaySheet({ s, date, onClose }) {
  const { currency } = useApp();
  const accounts = useAccounts({ includeArchived: false }) || [];
  const toast = useToast();
  const [amount, setAmount] = useState(s.variable_amount ? null : s.amount);
  const [account, setAccount] = useState(s.account_id);
  const [paidOn, setPaidOn] = useState(toLocalDate());
  const [errors, setErrors] = useState({});
  const isBill = s.kind === 'bill';
  async function save() {
    try {
      await S.recordOccurrence(s.id, date, { amount, account_id: account, paid_on: paidOn });
      toast(isBill ? `${s.name} marked as paid` : `${s.name} recorded`);
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast('Something went wrong. Your data is safe. Please try again.', { tone: 'error' });
    }
  }
  return (
    <Sheet open onClose={onClose} title={isBill ? `Bayad na: ${s.name}` : `Record ${s.name}`} footer={<button className="btn-gain w-full" onClick={save}>{isBill ? 'Mark as paid' : 'Record'}</button>}>
      <div className="space-y-5">
        <p className="text-sm muted">For the date due {friendlyDate(date)}.{isBill ? ' This records an expense and moves the bill to its next due date.' : ''}</p>
        <Field label={s.variable_amount ? 'How much was the bill?' : 'Amount'} error={errors.amount}>
          <MoneyInput value={amount} onChange={setAmount} currency={currency} error={errors.amount} aria-label="Amount paid" data-autofocus />
        </Field>
        {s.type !== 'transfer' && (
          <Field label={s.type === 'income' ? 'Into account' : 'Paid from'} error={errors.account_id}>
            <div className="flex flex-wrap gap-2">{accounts.map((a) => <button type="button" key={a.id} className={`chip ${account === a.id ? 'chip-on' : ''}`} aria-pressed={account === a.id} onClick={() => setAccount(a.id)}>{a.name}</button>)}</div>
          </Field>
        )}
        <Field label={isBill ? 'Date paid' : 'Date'} htmlFor="pay-date" error={errors.paid_on}><input id="pay-date" type="date" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

// ---------- add / edit ----------
function ScheduleForm({ value, onClose }) {
  const { currency } = useApp();
  const accounts = useAccounts({ includeArchived: false }) || [];
  const cats = useCategories();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (!value) return;
    setErrors({});
    const kind = value.kind || 'bill';
    setF({
      name: '', type: 'expense', amount: null, variable_amount: false, account_id: accounts[0]?.id || '', to_account_id: '', category_id: '', payee: '', notes: '',
      frequency: 'monthly', interval: 1, interval_unit: 'day', start_date: toLocalDate(), end_date: '', max_count: '', auto: true, ...value, kind,
      ends: value.end_date ? 'date' : value.max_count ? 'count' : 'never'
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => { if (f && !f.account_id && accounts.length) setF((x) => ({ ...x, account_id: accounts[0].id })); }, [accounts, f]);
  if (!value || !f || !cats) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const isBill = f.kind === 'bill';
  const type = isBill ? 'expense' : f.type;
  const catList = type === 'income' ? cats.income : cats.expense;
  async function save() {
    try {
      const r = await S.saveSchedule({ ...f, type, end_date: f.ends === 'date' ? f.end_date : null, max_count: f.ends === 'count' ? f.max_count : null }, value.id || null);
      toast(value.id ? 'Saved' : isBill ? 'Bill added' : `Recurring added${r.caughtUp ? ` · ${r.caughtUp} past date${r.caughtUp > 1 ? 's' : ''} recorded` : ''}`);
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else toast('Something went wrong. Your data is safe. Please try again.', { tone: 'error' });
    }
  }
  return (
    <Sheet open onClose={onClose} title={value.id ? `Edit ${isBill ? 'bill' : 'recurring'}` : isBill ? 'New bill' : 'New recurring'}
      footer={<button className="btn-primary w-full" onClick={save}>{value.id ? 'Save changes' : 'Save'}</button>}>
      <div className="space-y-5">
        {!value.id && <Segmented label="Kind" value={f.kind} onChange={set('kind')} options={[['bill', 'Bill (I confirm)'], ['recurring', 'Recurring']]} />}
        <Field label="Name" htmlFor="s-name" error={errors.name}>
          <input id="s-name" data-autofocus className={`input ${errors.name ? 'input-error' : ''}`} value={f.name} onChange={set('name')} placeholder={isBill ? 'e.g. Internet, Rent, Meralco' : 'e.g. Salary, Netflix, Ipon'} />
        </Field>
        {!isBill && <Segmented label="Transaction type" value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v, category_id: '' }))} options={[['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']]} />}
        <Field label="Amount" error={errors.amount}>
          {!(isBill && f.variable_amount) && <MoneyInput value={f.amount} onChange={set('amount')} currency={currency} error={errors.amount} aria-label="Amount" />}
          {isBill && <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" className="h-4 w-4 accent-ink" checked={!!f.variable_amount} onChange={set('variable_amount')} /> Amount changes every time (e.g. electricity)</label>}
        </Field>
        {type !== 'transfer' && (
          <Field label="Category" htmlFor="s-cat" error={errors.category_id}>
            <select id="s-cat" className={`input ${errors.category_id ? 'input-error' : ''}`} value={f.category_id || ''} onChange={set('category_id')}>
              <option value="">Choose…</option>
              {catList.map((c) => <option key={c.id} value={c.id}>{cats.label(c.id)}</option>)}
            </select>
          </Field>
        )}
        <Field label={type === 'transfer' ? 'From account' : type === 'income' ? 'Into account' : 'Paid from'} error={errors.account_id}>
          <div className="flex flex-wrap gap-2">{accounts.map((a) => <button type="button" key={a.id} className={`chip ${f.account_id === a.id ? 'chip-on' : ''}`} aria-pressed={f.account_id === a.id} onClick={() => set('account_id')(a.id)}>{a.name}</button>)}</div>
        </Field>
        {type === 'transfer' && (
          <Field label="To account" error={errors.to_account_id}>
            <div className="flex flex-wrap gap-2">{accounts.filter((a) => a.id !== f.account_id).map((a) => <button type="button" key={a.id} className={`chip ${f.to_account_id === a.id ? 'chip-on' : ''}`} aria-pressed={f.to_account_id === a.id} onClick={() => set('to_account_id')(a.id)}>{a.name}</button>)}</div>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="How often" htmlFor="s-freq" error={errors.frequency}>
            <select id="s-freq" className="input" value={f.frequency} onChange={set('frequency')}>{S.FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <Field label={isBill ? 'First due date' : 'First date'} htmlFor="s-start" error={errors.start_date}>
            <input id="s-start" type="date" className="input" value={f.start_date} onChange={set('start_date')} />
          </Field>
        </div>
        {f.frequency === 'custom' && (
          <Field label="Repeat every" error={errors.interval}>
            <div className="flex gap-2">
              <input type="number" min="1" max="365" inputMode="numeric" aria-label="Interval" className="input w-24" value={f.interval} onChange={set('interval')} />
              <select className="input" aria-label="Unit" value={f.interval_unit} onChange={set('interval_unit')}><option value="day">days</option><option value="week">weeks</option><option value="month">months</option></select>
            </div>
          </Field>
        )}
        <Field label="Ends" error={errors.end_date || errors.max_count}>
          <div className="flex flex-wrap gap-2">
            {[['never', 'Never'], ['date', 'On a date'], ['count', 'After a number of times']].map(([v, l]) => <button type="button" key={v} className={`chip ${f.ends === v ? 'chip-on' : ''}`} onClick={() => set('ends')(v)}>{l}</button>)}
          </div>
          {f.ends === 'date' && <input type="date" aria-label="End date" className="input mt-2" value={f.end_date || ''} onChange={set('end_date')} />}
          {f.ends === 'count' && <input type="number" min="1" inputMode="numeric" aria-label="Number of times" className="input mt-2 w-32" value={f.max_count || ''} onChange={set('max_count')} placeholder="e.g. 12" />}
        </Field>
        {!isBill && (
          <Field label="When the date comes">
            <Segmented label="Mode" value={f.auto ? 'auto' : 'ask'} onChange={(v) => set('auto')(v === 'auto')} options={[['auto', 'Record automatically'], ['ask', 'Ask me first']]} />
          </Field>
        )}
        <Field label="Notes" htmlFor="s-notes"><input id="s-notes" className="input" value={f.notes || ''} onChange={set('notes')} placeholder="Optional" /></Field>
        {value.id && <p className="text-[13px] muted">Changing how often or the first date applies from today on. Past records stay as they are.</p>}
      </div>
    </Sheet>
  );
}

// ---------- dashboard card ----------
export function UpcomingBillsCard() {
  const { currency } = useApp();
  const rows = useSchedules();
  if (!rows) return null;
  const today = toLocalDate();
  const week = addDays(today, 7);
  const items = rows.filter((r) => !r.s.paused_at && (r.s.kind === 'bill' || !r.s.auto))
    .flatMap((r) => r.sum.all.filter((o) => ['overdue', 'today', 'soon'].includes(o.state) && o.date <= week).map((o) => ({ ...o, s: r.s })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = items.reduce((sum, x) => sum + (x.s.amount || 0), 0);
  const overdue = items.filter((x) => x.state === 'overdue').length;
  return (
    <section className="card p-5" aria-labelledby="bills-h">
      <div className="flex items-center justify-between">
        <h2 id="bills-h" className="text-base font-semibold">Upcoming bills</h2>
        <Link to="/bills" className="text-sm font-medium muted hover:text-ink dark:hover:text-white inline-flex items-center">{rows.length ? 'All bills' : 'Add a bill'} <ChevronRight size={16} /></Link>
      </div>
      {!items.length ? <p className="text-sm muted mt-2">{rows.length ? 'Nothing due in the next 7 days.' : 'Add rent, internet or tuition to see what’s coming due.'}</p> : (
        <>
          <p className="text-sm mt-1">{total > 0 && <><span className="money font-semibold">{formatMoney(total, currency)}</span>{' '}</>}<span className="muted">{items.length} due in the next 7 days{items.some((x) => x.s.variable_amount) && total > 0 ? ' (plus varying amounts)' : ''}</span>{overdue ? <span className="text-loss dark:text-loss-dark font-medium"> · {overdue} overdue</span> : null}</p>
          <ul className="mt-2 divide-y divide-ink-100/70 dark:divide-night-line">
            {items.slice(0, 5).map((o) => (
              <li key={o.s.id + o.date}><Link to="/bills" className="flex items-center gap-2 py-2.5">
                <span className="flex-1 min-w-0"><span className="block text-[14.5px] font-medium truncate">{o.s.name}</span><span className="block text-[12.5px] muted">{friendlyDate(o.date)}</span></span>
                <span className="money text-sm font-medium">{o.s.variable_amount ? 'Varies' : formatMoney(o.s.amount, currency)}</span>
                <Badge state={o.state} />
              </Link></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}