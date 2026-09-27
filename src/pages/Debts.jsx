import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Pencil, MessageCircle, HandCoins, X, Ban, RotateCcw } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { useAccounts, useBalances, usePeople } from '../hooks/useData.js';
import { PageHeader, Sheet, Field, MoneyInput, Segmented, useToast, useConfirm } from '../components/ui.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import { debtStatus } from '../services/calc.js';
import * as D from '../services/debts.js';
import { ValidationError } from '../services/ledger.js';
import { formatMoney } from '../lib/money.js';
import { toLocalDate, friendlyDate, parseLocalDate } from '../lib/dates.js';

const STATUS = {
  unpaid: ['Unpaid', 'bg-ink-50 text-ink-600 dark:bg-night-line dark:text-slate-300'],
  partial: ['Partially paid', 'bg-info-soft text-info dark:bg-info/15'],
  overdue: ['Overdue', 'bg-loss-soft text-loss dark:bg-loss/15 dark:text-loss-dark'],
  paid: ['Paid ✓', 'bg-gain-soft text-gain dark:bg-gain/15 dark:text-gain-dark'],
  forgiven: ['Not collecting', 'bg-warn-soft text-warn dark:bg-warn/15']
};
const Badge = ({ status }) => <span className={`inline-flex items-center rounded-full px-2 h-6 text-[11.5px] font-semibold ${STATUS[status][1]}`}>{STATUS[status][0]}</span>;
const shortDate = (s) => parseLocalDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s.slice(0, 4) === toLocalDate().slice(0, 4) ? undefined : 'numeric' });

export default function Debts() {
  const { currency } = useApp();
  const data = useBalances();
  const people = usePeople();
  const [params, setParams] = useSearchParams();
  const [dir, setDir] = useState('owed_to_me');
  const [show, setShow] = useState('active');
  const [form, setForm] = useState(null);
  const [openId, setOpenId] = useState(params.get('debt'));
  useEffect(() => { const id = params.get('debt'); if (id) { setOpenId(id); params.delete('debt'); setParams(params, { replace: true }); } }, [params, setParams]);

  const view = useMemo(() => {
    if (!data || !people) return null;
    const rows = data.debts.map((d) => ({ d, st: debtStatus(d, data.txs), person: people.get(d.person_id) }));
    const mine = rows.filter((r) => r.d.direction === dir);
    const active = mine.filter((r) => r.st.remaining > 0);
    const settled = mine.filter((r) => r.st.remaining === 0);
    const list = show === 'active' ? active : settled;
    const groups = new Map();
    for (const r of list) {
      const g = groups.get(r.d.person_id) || { person: r.person, items: [], remaining: 0 };
      g.items.push(r); g.remaining += r.st.remaining; groups.set(r.d.person_id, g);
    }
    const sorted = [...groups.values()].sort((a, b) => b.remaining - a.remaining || (a.person?.name || '').localeCompare(b.person?.name || ''));
    sorted.forEach((g) => g.items.sort((a, b) => (a.st.status === 'overdue' ? -1 : 0) - (b.st.status === 'overdue' ? -1 : 0) || b.d.date.localeCompare(a.d.date)));
    return {
      groups: sorted, total: active.reduce((s, r) => s + r.st.remaining, 0), people: new Set(active.map((r) => r.d.person_id)).size,
      overdue: active.filter((r) => r.st.status === 'overdue').length, counts: { active: active.length, settled: settled.length }, byId: new Map(rows.map((r) => [r.d.id, r]))
    };
  }, [data, people, dir, show]);

  if (!view) return <div className="skeleton h-64" />;
  const open = openId ? view.byId.get(openId) : null;
  const toMe = dir === 'owed_to_me';

  return (
    <div>
      <PageHeader title="Utang" subtitle="Money you lent and money you owe" actions={<button className="btn-primary btn-sm" onClick={() => setForm({ direction: dir })}><Plus size={16} /> {toMe ? 'Pautang' : 'Utang ko'}</button>} />
      <div className="max-w-md"><Segmented label="Direction" value={dir} onChange={(v) => { setDir(v); setShow('active'); }} options={[['owed_to_me', 'May utang sa akin'], ['i_owe', 'Utang ko']]} /></div>

      <section className={`mt-4 rounded-3xl p-5 sm:p-6 ${toMe ? 'bg-ink text-white dark:bg-[#18214A]' : 'card'}`} aria-label="Summary">
        <p className={`text-sm ${toMe ? 'text-white/60' : 'muted'}`}>{toMe ? 'Total na may utang sa iyo' : 'Total na utang mo'}</p>
        <p className="money text-4xl font-semibold mt-1">{formatMoney(view.total, currency)}</p>
        <p className={`text-sm mt-1 ${toMe ? 'text-white/60' : 'muted'}`}>
          {view.people} {view.people === 1 ? 'person' : 'people'}{view.overdue ? <> · <span className={toMe ? 'text-loss-dark font-semibold' : 'text-loss font-semibold'}>{view.overdue} overdue</span></> : null}
        </p>
      </section>

      <div className="flex gap-2 mt-4">
        <button className={`chip ${show === 'active' ? 'chip-on' : ''}`} onClick={() => setShow('active')} aria-pressed={show === 'active'}>Active ({view.counts.active})</button>
        <button className={`chip ${show === 'settled' ? 'chip-on' : ''}`} onClick={() => setShow('settled')} aria-pressed={show === 'settled'}>Settled ({view.counts.settled})</button>
      </div>

      <div className="mt-3 space-y-4">
        {!view.groups.length ? (
          <div className="card"><EmptyState art="wallet" title={show === 'settled' ? 'Nothing settled yet' : toMe ? 'Walang may utang sa iyo' : 'Wala kang utang'}
            body={show === 'active' ? (toMe ? 'Record money you lend so you always know who still owes you.' : 'Record money you borrowed and track what’s left to pay.') : null}
            action={show === 'active' && <button className="btn-primary" onClick={() => setForm({ direction: dir })}><Plus size={18} /> {toMe ? 'Add pautang' : 'Add utang'}</button>} /></div>
        ) : view.groups.map((g) => (
          <section key={g.person?.id} className="card p-1.5 sm:p-2" aria-label={g.person?.name}>
            <div className="flex justify-between px-3 pt-2 pb-1">
              <h2 className="font-semibold font-sans">{g.person?.name}</h2>
              {show === 'active' && <span className="money font-semibold">{formatMoney(g.remaining, currency)}</span>}
            </div>
            {g.items.map(({ d, st }) => (
              <button key={d.id} onClick={() => setOpenId(d.id)} className="w-full text-left px-3 py-3 rounded-xl hover:bg-ink-50/70 dark:hover:bg-night-line/60">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-medium truncate">{formatMoney(d.amount, currency)} · {shortDate(d.date)}{d.notes ? ` · ${d.notes}` : ''}</span>
                    <span className="block text-[12.5px] muted">{st.remaining ? `${formatMoney(st.remaining, currency)} left` : st.lastPayment ? `Settled ${shortDate(st.lastPayment)}` : 'Settled'}{d.due_date && st.remaining ? ` · due ${shortDate(d.due_date)}` : ''}</span>
                  </span>
                  <Badge status={st.status} />
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-ink-50 dark:bg-night-line overflow-hidden"><div className={`h-full rounded-full ${st.status === 'overdue' ? 'bg-loss' : 'bg-gain'}`} style={{ width: `${st.pct}%` }} /></div>
              </button>
            ))}
          </section>
        ))}
      </div>

      <DebtForm value={form} onClose={() => setForm(null)} />
      {open && <DebtSheet row={open} onClose={() => setOpenId(null)} onEdit={() => { setForm({ ...open.d, person_name: open.person?.name, phone: open.person?.phone }); setOpenId(null); }} />}
    </div>
  );
}

// ---------- Add / edit ----------
function DebtForm({ value, onClose }) {
  const { currency } = useApp();
  const accounts = (useAccounts({ includeArchived: false }) || []);
  const people = usePeople();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (!value) return;
    setErrors({});
    setF(value.id ? { ...value, account_id: value.account_id || '', _picked: true } : { direction: value.direction || 'owed_to_me', person_name: '', phone: '', amount: null, date: toLocalDate(), due_date: '', account_id: accounts[0]?.id || '', notes: '', _picked: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => {
    if (f && !f._picked && !f.account_id && accounts.length) setF((x) => ({ ...x, account_id: accounts[0].id }));
  }, [accounts, f]);
  if (!value || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const toMe = f.direction === 'owed_to_me';
  async function save() {
    try {
      await D.saveDebt({ ...f, account_id: f.account_id || null }, value.id || null);
      toast(value.id ? 'Updated' : toMe ? 'Pautang saved' : 'Utang saved');
      onClose();
    } catch (e) { if (e instanceof ValidationError) setErrors(e.fields); else toast('Something went wrong. Your data is safe. Please try again.', { tone: 'error' }); }
  }
  const names = [...(people?.values() || [])].map((p) => p.name).sort();
  return (
    <Sheet open onClose={onClose} title={value.id ? 'Edit' : toMe ? 'New pautang' : 'New utang'} footer={<button className="btn-primary w-full" onClick={save}>{value.id ? 'Save changes' : 'Save'}</button>}>
      <div className="space-y-5">
        {!value.id && <Segmented label="Direction" value={f.direction} onChange={set('direction')} options={[['owed_to_me', 'Nagpautang ako'], ['i_owe', 'Umutang ako']]} />}
        <Field label={toMe ? 'Sino ang umutang?' : 'Kanino ka umutang?'} htmlFor="d-person" error={errors.person_name}>
          <input id="d-person" data-autofocus list="d-people" className={`input ${errors.person_name ? 'input-error' : ''}`} value={f.person_name} onChange={set('person_name')} placeholder="Name" autoComplete="off" />
          <datalist id="d-people">{names.map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        <Field label="Amount" error={errors.amount}><MoneyInput value={f.amount} onChange={set('amount')} currency={currency} error={errors.amount} aria-label="Amount" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="d-date" error={errors.date}><input id="d-date" type="date" className="input" value={f.date} onChange={set('date')} /></Field>
          <Field label="Due date (optional)" htmlFor="d-due" error={errors.due_date}><input id="d-due" type="date" className="input" value={f.due_date || ''} onChange={set('due_date')} /></Field>
        </div>
        <Field label={toMe ? 'Saan galing ang pera?' : 'Saan pumasok ang pera?'} error={errors.account_id}
          hint={!f.account_id ? 'Old debt from before you used Pera — no account balance will change.' : toMe ? 'This amount leaves the account now and comes back as they pay.' : 'This amount is added to the account now.'}>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => <button type="button" key={a.id} className={`chip ${f.account_id === a.id ? 'chip-on' : ''}`} aria-pressed={f.account_id === a.id} onClick={() => setF((x) => ({ ...x, account_id: a.id, _picked: true }))}>{a.name}</button>)}
            <button type="button" className={`chip ${!f.account_id ? 'chip-on' : ''}`} aria-pressed={!f.account_id} onClick={() => setF((x) => ({ ...x, account_id: '', _picked: true }))}>Dating utang</button>
          </div>
        </Field>
        <Field label="Phone (optional)" htmlFor="d-phone" hint="Used only for sending a reminder text yourself."><input id="d-phone" type="tel" className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Notes" htmlFor="d-notes"><input id="d-notes" className="input" value={f.notes} onChange={set('notes')} placeholder="e.g. pang-tuition" /></Field>
      </div>
    </Sheet>
  );
}

// ---------- Details + payments ----------
function DebtSheet({ row, onClose, onEdit }) {
  const { currency } = useApp();
  const accounts = useAccounts() || [];
  const toast = useToast();
  const confirm = useConfirm();
  const [paying, setPaying] = useState(false);
  const { d, st, person } = row;
  const toMe = d.direction === 'owed_to_me';
  const accName = (id) => accounts.find((a) => a.id === id)?.name || '—';

  async function remind() {
    const text = D.reminderText(person, d, st, currency);
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch { return; /* user cancelled */ }
    if (person.phone && /Android|iPhone|iPad/.test(navigator.userAgent)) { location.href = `sms:${person.phone}?body=${encodeURIComponent(text)}`; return; }
    await navigator.clipboard?.writeText(text);
    toast('Message copied. Paste it in Messenger or SMS.');
  }
  async function forgive() {
    const ok = await confirm({
      title: toMe ? `Stop collecting from ${person.name}?` : `Mark as cancelled?`,
      message: `${formatMoney(st.remaining, currency)} will be cleared from this ${toMe ? 'loan' : 'debt'}. No account balance changes; your net worth ${toMe ? 'goes down' : 'goes up'} by that amount. You can undo this.`,
      confirmLabel: toMe ? 'Stop collecting' : 'Mark cancelled', danger: toMe
    });
    if (!ok) return;
    await D.forgiveDebt(d.id); toast('Updated', { action: { label: 'Undo', onClick: () => D.undoForgive(d.id) } });
  }
  async function remove() {
    const ok = await confirm({ title: 'Delete this record?', message: 'The loan and all its payments move to Trash and account balances go back to how they were before. You can restore it from Trash.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await D.deleteDebt(d.id); onClose(); toast('Moved to Trash', { action: { label: 'Undo', onClick: () => D.restoreDebt(d.id) } });
  }
  async function undoPayment(t) {
    const ok = await confirm({ title: 'Remove this payment?', message: `${formatMoney(t.amount, currency)} on ${friendlyDate(t.date)} will be removed and the balance goes back up.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await D.deletePayment(t.id); toast('Payment removed');
  }

  return (
    <>
    <Sheet open={!paying} onClose={onClose} title={person?.name}
      footer={st.remaining > 0 ? <button className="btn-gain w-full" onClick={() => setPaying(true)}><HandCoins size={18} /> {toMe ? 'Nagbayad siya' : 'Magbayad'}</button> : null}>
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2"><Badge status={st.status} />{d.due_date && st.remaining > 0 && <span className="text-[13px] muted">Due {friendlyDate(d.due_date)}</span>}</div>
          <p className="money text-4xl font-semibold mt-2">{formatMoney(st.remaining, currency)}</p>
          <p className="muted text-sm">{st.remaining ? 'left' : 'nothing left'} of {formatMoney(d.amount, currency)} · {Math.round(st.pct)}% {toMe ? 'collected' : 'paid'}</p>
          <div className="mt-3 h-2 rounded-full bg-ink-50 dark:bg-night-line overflow-hidden"><div className="h-full rounded-full bg-gain" style={{ width: `${st.pct}%` }} /></div>
        </div>
        <dl className="text-sm divide-y divide-ink-100/70 dark:divide-night-line">
          <div className="flex justify-between py-2"><dt className="muted">{toMe ? 'Lent on' : 'Borrowed on'}</dt><dd>{friendlyDate(d.date)}</dd></div>
          <div className="flex justify-between py-2"><dt className="muted">{toMe ? 'From account' : 'Into account'}</dt><dd>{d.account_id ? accName(d.account_id) : 'Dating utang (no account)'}</dd></div>
          {d.notes && <div className="flex justify-between py-2"><dt className="muted">Notes</dt><dd className="text-right">{d.notes}</dd></div>}
          {st.forgiven > 0 && <div className="flex justify-between py-2"><dt className="muted">{toMe ? 'Not collecting' : 'Cancelled'}</dt><dd className="money">{formatMoney(st.forgiven, currency)}</dd></div>}
        </dl>
        <div>
          <h3 className="text-sm font-semibold mb-1 font-sans">Payments</h3>
          {!st.payments.length ? <p className="text-sm muted">No payments yet.</p> : (
            <ul className="divide-y divide-ink-100/70 dark:divide-night-line">
              {[...st.payments].reverse().map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex-1">{friendlyDate(t.date)} · {accName(t.account_id)}{t.notes ? ` · ${t.notes}` : ''}</span>
                  <span className="money font-medium">{formatMoney(t.amount, currency)}</span>
                  <button className="icon-btn w-8 h-8" onClick={() => undoPayment(t)} aria-label="Remove payment"><X size={15} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {toMe && st.remaining > 0 && <button className="btn-soft btn-sm" onClick={remind}><MessageCircle size={15} /> Paalalahanan si {person?.name.split(' ')[0]}</button>}
          <button className="btn-soft btn-sm" onClick={onEdit}><Pencil size={15} /> Edit</button>
          {st.remaining > 0 && <button className="btn-soft btn-sm" onClick={forgive}><Ban size={15} /> {toMe ? 'Stop collecting' : 'Cancelled by lender'}</button>}
          {st.forgiven > 0 && <button className="btn-soft btn-sm" onClick={() => D.undoForgive(d.id)}><RotateCcw size={15} /> Resume collecting</button>}
          <button className="btn-ghost btn-sm text-loss" onClick={remove}><Trash2 size={15} /> Delete</button>
        </div>
      </div>
    </Sheet>
    {paying && <PaymentSheet row={row} onClose={() => setPaying(false)} />}
    </>
  );
}

function PaymentSheet({ row, onClose }) {
  const { currency } = useApp();
  const accounts = useAccounts({ includeArchived: false }) || [];
  const toast = useToast();
  const { d, st, person } = row;
  const toMe = d.direction === 'owed_to_me';
  const [amount, setAmount] = useState(st.remaining);
  const [account, setAccount] = useState(null);
  // Default to the loan's own account (or the first account) once the account list has loaded.
  useEffect(() => {
    if (account || !accounts.length) return;
    setAccount(d.account_id && accounts.some((a) => a.id === d.account_id) ? d.account_id : accounts[0].id);
  }, [accounts, account, d.account_id]);
  const [date, setDate] = useState(toLocalDate());
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const half = Math.floor(st.remaining / 2);
  const excess = amount ? Math.max(0, amount - st.remaining) : 0;
  async function save() {
    try {
      const r = await D.recordPayment(d.id, { amount, account_id: account, date, notes });
      const left = st.remaining - r.applied;
      toast(left ? `${formatMoney(r.applied, currency)} recorded · ${formatMoney(left, currency)} left` : `Fully paid! 🎉${r.excess ? ` Extra ${formatMoney(r.excess, currency)} saved as ${toMe ? 'income' : 'expense'}.` : ''}`);
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields);
      else { console.error('[pera] payment failed:', e?.name, e?.message); toast('Something went wrong. Your data is safe. Please try again.', { tone: 'error' }); }
    }
  }
  return (
    <Sheet open onClose={onClose} title={toMe ? `Bayad ni ${person?.name}` : `Bayad kay ${person?.name}`} footer={<button className="btn-gain w-full" onClick={save}>Save payment</button>}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`chip ${amount === st.remaining ? 'chip-on' : ''}`} onClick={() => setAmount(st.remaining)}>Buo · {formatMoney(st.remaining, currency)}</button>
          {half > 0 && <button type="button" className={`chip ${amount === half ? 'chip-on' : ''}`} onClick={() => setAmount(half)}>Kalahati · {formatMoney(half, currency)}</button>}
        </div>
        <Field label="Amount" error={errors.amount}><MoneyInput value={amount} onChange={setAmount} currency={currency} error={errors.amount} aria-label="Payment amount" data-autofocus /></Field>
        {excess > 0 && <p className="text-sm rounded-xl bg-info-soft dark:bg-info/15 px-3.5 py-2.5">That's {formatMoney(excess, currency)} more than what's left. The extra will be saved separately as {toMe ? 'income (Interest)' : 'an expense (Loan interest)'}.</p>}
        {amount > 0 && amount < st.remaining && <p className="text-sm muted">{formatMoney(st.remaining - amount, currency)} will still be left after this payment.</p>}
        <Field label={toMe ? 'Saan pumasok ang bayad?' : 'Saan galing ang pambayad?'} error={errors.account_id}>
          <div className="flex flex-wrap gap-2">{accounts.map((a) => <button type="button" key={a.id} className={`chip ${account === a.id ? 'chip-on' : ''}`} aria-pressed={account === a.id} onClick={() => setAccount(a.id)}>{a.name}</button>)}</div>
        </Field>
        <Field label="Date" htmlFor="p-date" error={errors.date}><input id="p-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="p-notes"><input id="p-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </Sheet>
  );
}
