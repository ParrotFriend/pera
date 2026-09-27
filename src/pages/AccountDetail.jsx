import { useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Scale, Archive, ArchiveRestore, Trash2, Plus } from 'lucide-react';
import { useBalances, useCategories } from '../hooks/useData.js';
import { PageHeader, Sheet, Field, MoneyInput, useConfirm, useToast } from '../components/ui.jsx';
import TransactionItem from '../components/TransactionItem.jsx';
import AccountForm from '../components/AccountForm.jsx';
import { accountStatement } from '../services/calc.js';
import { isLiabilityType, ACCOUNT_TYPES } from '../services/defaults.js';
import * as L from '../services/ledger.js';
import { formatMoney } from '../lib/money.js';
import { toLocalDate, startOfMonth, endOfMonth, shiftMonth, monthLabel } from '../lib/dates.js';

export default function AccountDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { openAdd, openEdit } = useOutletContext();
  const data = useBalances();
  const cats = useCategories();
  const confirm = useConfirm();
  const toast = useToast();
  const [month, setMonth] = useState(startOfMonth(toLocalDate()));
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const acc = data.accounts.find((a) => a.id === id);
    if (!acc) return { missing: true };
    const mine = data.txs.filter((t) => t.account_id === id || t.to_account_id === id);
    const st = accountStatement(acc, mine, month, endOfMonth(month));
    const list = mine.filter((t) => t.date >= month && t.date <= endOfMonth(month)).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return { acc, st, list, balance: data.balances.get(id) || 0, accMap: new Map(data.accounts.map((a) => [a.id, a])), count: mine.length };
  }, [data, id, month]);

  if (!view || !cats) return <div className="skeleton h-64" />;
  if (view.missing) return <div className="card p-8 text-center"><p>This account no longer exists.</p><Link className="btn-soft mt-4" to="/accounts">Back to accounts</Link></div>;
  const { acc, st, list, balance } = view;
  const cur = acc.currency;
  const liability = isLiabilityType(acc.type);

  async function remove() {
    const hasHistory = view.count > 0;
    const ok = await confirm(hasHistory
      ? { title: `Archive ${acc.name}?`, message: 'This account has transactions, so it will be archived instead of deleted. Its history stays in your reports and you can unarchive it anytime.', confirmLabel: 'Archive' }
      : { title: `Delete ${acc.name}?`, message: 'It has no transactions. It moves to Trash, where you can restore it.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const r = await L.removeAccount(acc.id);
    toast(r === 'archived' ? `${acc.name} archived` : `${acc.name} moved to Trash`);
    if (r === 'trashed') nav('/accounts');
  }

  return (
    <div>
      <PageHeader title={acc.name} subtitle={`${ACCOUNT_TYPES.find((t) => t.value === acc.type)?.label}${acc.archived_at ? ' · Archived' : ''}`}
        back={<Link to="/accounts" className="icon-btn -ml-2" aria-label="Back to accounts"><ChevronLeft size={22} /></Link>}
        actions={<button className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit account"><Pencil size={18} /></button>} />

      <section className="rounded-3xl p-5 sm:p-6 text-white" style={{ background: `linear-gradient(135deg, ${acc.color}, #141B3C)` }}>
        <p className="text-white/70 text-sm">{liability ? 'Amount owed' : 'Current balance'}</p>
        <p className="money text-4xl sm:text-5xl font-semibold mt-1">{formatMoney(liability ? -balance : balance, cur)}</p>
        {acc.description && <p className="text-white/70 text-sm mt-2">{acc.description}</p>}
        <div className="flex flex-wrap gap-2 mt-5">
          {!acc.archived_at && <button className="btn-sm btn bg-white text-ink" onClick={() => openAdd('expense', { account_id: acc.id })}><Plus size={16} /> Add</button>}
          <button className="btn-sm btn bg-white/15 text-white hover:bg-white/25" onClick={() => setReconciling(true)}><Scale size={16} /> Reconcile</button>
          {acc.archived_at
            ? <button className="btn-sm btn bg-white/15 text-white hover:bg-white/25" onClick={() => L.setAccountArchived(acc.id, false).then(() => toast('Account unarchived'))}><ArchiveRestore size={16} /> Unarchive</button>
            : <button className="btn-sm btn bg-white/15 text-white hover:bg-white/25" onClick={remove}>{view.count ? <Archive size={16} /> : <Trash2 size={16} />} {view.count ? 'Archive' : 'Delete'}</button>}
        </div>
      </section>

      <section className="card p-5 mt-5" aria-labelledby="stmt-h">
        <div className="flex items-center justify-between">
          <h2 id="stmt-h" className="text-base font-semibold">Statement</h2>
          <div className="flex items-center gap-1">
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
            <span className="text-sm font-medium w-32 text-center">{monthLabel(month)}</span>
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
          </div>
        </div>
        <dl className="mt-3 divide-y divide-ink-100/70 dark:divide-night-line text-[14.5px]">
          <Row label="Opening balance" value={formatMoney(st.opening, cur)} />
          <Row label="Income" value={formatMoney(st.income, cur, { sign: true })} tone="in" />
          <Row label="Expenses" value={formatMoney(-st.spent, cur)} />
          {st.refunds > 0 && <Row label="Refunds" value={formatMoney(st.refunds, cur, { sign: true })} tone="in" />}
          <Row label="Transfers in" value={formatMoney(st.transferIn, cur, { sign: true })} />
          <Row label="Transfers out" value={formatMoney(-st.transferOut, cur)} />
          {(st.adjustIn > 0 || st.adjustOut > 0) && <Row label="Adjustments" value={formatMoney(st.adjustIn - st.adjustOut, cur, { sign: true })} />}
          {(st.debtIn > 0 || st.debtOut > 0) && <Row label="Utang (lent, borrowed, repaid)" value={formatMoney(st.debtIn - st.debtOut, cur, { sign: true })} />}
          <Row label="Closing balance" value={formatMoney(st.closing, cur)} strong />
        </dl>
      </section>

      <section className="card p-1.5 sm:p-2 mt-5" aria-labelledby="acc-tx-h">
        <div className="flex justify-between items-center px-3 pt-2 pb-1">
          <h2 id="acc-tx-h" className="text-base font-semibold">{monthLabel(month)}</h2>
          <Link to={`/transactions?account=${acc.id}`} className="text-sm muted inline-flex items-center">All transactions <ChevronRight size={16} /></Link>
        </div>
        {list.length ? list.map((t) => <TransactionItem key={t.id} tx={t} accounts={view.accMap} cats={cats} onClick={openEdit} focusAccountId={acc.id} />)
          : <p className="px-3 py-6 text-sm muted">No transactions in {monthLabel(month)}.</p>}
      </section>

      <AccountForm open={editing} onClose={() => setEditing(false)} editing={acc} />
      <ReconcileSheet open={reconciling} onClose={() => setReconciling(false)} account={acc} recorded={balance} />
    </div>
  );
}

function Row({ label, value, tone, strong }) {
  return (
    <div className="flex justify-between py-2.5">
      <dt className={strong ? 'font-semibold' : 'muted'}>{label}</dt>
      <dd className={`money ${strong ? 'font-semibold' : ''} ${tone === 'in' ? 'amount-in' : ''}`}>{value}</dd>
    </div>
  );
}

function ReconcileSheet({ open, onClose, account, recorded }) {
  const toast = useToast();
  const [actual, setActual] = useState(null);
  const [note, setNote] = useState('');
  const liability = isLiabilityType(account.type);
  // For liabilities, the user types what they owe (positive); internally it's negative.
  const actualInternal = actual == null ? null : liability ? -actual : actual;
  const diff = actualInternal == null ? null : actualInternal - recorded;
  async function save() {
    await L.reconcile(account.id, actualInternal, note);
    toast(diff === 0 ? 'Balances already match' : 'Adjustment recorded');
    setActual(null); setNote(''); onClose();
  }
  return (
    <Sheet open={open} onClose={onClose} title={`Reconcile ${account.name}`}
      footer={<div className="flex gap-2"><button className="btn-ghost flex-1" onClick={onClose}>Cancel</button><button className="btn-primary flex-1" disabled={actual == null} onClick={save}>{diff ? 'Record adjustment' : 'Confirm'}</button></div>}>
      <div className="space-y-4">
        <p className="text-sm muted">Check the real {liability ? 'amount owed' : 'balance'} in your {account.name} app or passbook. If it differs, look for a missing transaction first. If you can't find one, record an adjustment — your past transactions stay unchanged.</p>
        <div className="flex justify-between text-sm"><span className="muted">Recorded in Pera</span><span className="money font-medium">{formatMoney(liability ? -recorded : recorded, account.currency)}</span></div>
        <Field label={liability ? 'Actual amount owed' : 'Actual balance'}>
          <MoneyInput value={actual} onChange={setActual} currency={account.currency} allowNegative={!liability} data-autofocus />
        </Field>
        {diff != null && (
          <p className={`text-sm font-medium ${diff === 0 ? 'text-gain' : 'text-warn'}`}>
            {diff === 0 ? 'Balances match.' : `Difference: ${formatMoney(diff, account.currency, { sign: true })} — an adjustment of this amount will be added today.`}
          </p>
        )}
        {diff ? <Field label="Reason (optional)" htmlFor="rec-note"><input id="rec-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bank fee, forgot a jeep fare" /></Field> : null}
      </div>
    </Sheet>
  );
}
