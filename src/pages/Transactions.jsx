import { useMemo, useState, useDeferredValue } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, SlidersHorizontal, Download, Plus, X } from 'lucide-react';
import { db } from '../db/db.js';
import { useApp } from '../services/app.jsx';
import { useAccounts, useCategories } from '../hooks/useData.js';
import { PageHeader, Sheet, Field, useToast } from '../components/ui.jsx';
import TransactionItem from '../components/TransactionItem.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import { RANGE_OPTIONS, rangeFor, friendlyDate } from '../lib/dates.js';
import { formatMoney, parseMoney, toPlain } from '../lib/money.js';
import { exportTransactionsCsv } from '../services/exporter.js';

const PAGE = 60;
const TYPES = [['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers']];
const SORTS = [['newest', 'Newest'], ['oldest', 'Oldest'], ['high', 'Highest amount'], ['low', 'Lowest amount']];

export default function Transactions() {
  const { user, currency } = useApp();
  const { openAdd, openEdit } = useOutletContext();
  const toast = useToast();
  const [params] = useSearchParams();
  const accountsList = useAccounts();
  const cats = useCategories();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const [type, setType] = useState('all');
  const [f, setF] = useState({ range: 'all', from: '', to: '', account: params.get('account') || '', category: params.get('category') || '', tag: '', sort: 'newest' });
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const accounts = useMemo(() => new Map((accountsList || []).map((a) => [a.id, a])), [accountsList]);
  const range = f.range === 'custom' ? { from: f.from || '0000-01-01', to: f.to || '9999-12-31' } : rangeFor(f.range);

  const result = useLiveQuery(async () => {
    if (!user || !cats) return null;
    const needle = dq.trim().toLowerCase();
    const needleAmount = parseMoney(needle.replace(/^[-+]/, ''));
    const match = (t) => {
      if (t.deleted_at || t.purged_at) return false;
      if (type !== 'all' && t.type !== type && !(type === 'expense' && t.type === 'refund')) return false;
      if (f.account && t.account_id !== f.account && t.to_account_id !== f.account) return false;
      if (f.category && t.category_id !== f.category && cats.byId.get(t.category_id)?.parent_id !== f.category) return false;
      if (f.tag && !(t.tags || []).includes(f.tag.replace(/^#/, '').toLowerCase())) return false;
      if (!needle) return true;
      if (needleAmount != null && (t.amount === needleAmount || toPlain(t.amount).replace(/,/g, '').startsWith(needle))) return true;
      const hay = [t.payee, t.notes, (t.tags || []).map((x) => '#' + x).join(' '), cats.label(t.category_id), accounts.get(t.account_id)?.name, accounts.get(t.to_account_id)?.name, t.type].join(' ').toLowerCase();
      return hay.includes(needle);
    };
    // Indexed range scan on (user, date); never loads other users' rows.
    let coll = db.transactions.where('[user_id+date]').between([user.id, range.from], [user.id, range.to], true, true).filter(match);
    if (f.sort === 'newest' || f.sort === 'oldest') {
      if (f.sort === 'newest') coll = coll.reverse();
      const rows = await coll.limit(limit + 1).toArray();
      rows.sort((a, b) => (f.sort === 'newest' ? -1 : 1) * (a.date + a.time + a.created_at).localeCompare(b.date + b.time + b.created_at));
      return { rows: rows.slice(0, limit), more: rows.length > limit };
    }
    const all = await coll.toArray();
    all.sort((a, b) => (f.sort === 'high' ? b.amount - a.amount : a.amount - b.amount));
    return { rows: all.slice(0, limit), more: all.length > limit, all };
  }, [user?.id, cats, accounts, dq, type, f.account, f.category, f.tag, f.sort, range.from, range.to, limit]);

  const groups = useMemo(() => {
    if (!result || !(f.sort === 'newest' || f.sort === 'oldest')) return null;
    const g = [];
    for (const t of result.rows) {
      let last = g[g.length - 1];
      if (!last || last.date !== t.date) g.push((last = { date: t.date, items: [], net: 0 }));
      last.items.push(t);
      if (t.type === 'income' || t.type === 'refund') last.net += t.amount;
      if (t.type === 'expense') last.net -= t.amount;
    }
    return g;
  }, [result, f.sort]);

  const activeFilters = [
    f.range !== 'all' && [RANGE_OPTIONS.find((r) => r[0] === f.range)?.[1], () => setF({ ...f, range: 'all' })],
    f.account && [accounts.get(f.account)?.name, () => setF({ ...f, account: '' })],
    f.category && [cats?.label(f.category), () => setF({ ...f, category: '' })],
    f.tag && ['#' + f.tag.replace(/^#/, ''), () => setF({ ...f, tag: '' })],
    f.sort !== 'newest' && [SORTS.find((s) => s[0] === f.sort)[1], () => setF({ ...f, sort: 'newest' })]
  ].filter(Boolean);

  async function exportCsv() {
    const needle = dq.trim().toLowerCase();
    // export everything matching (not just the visible page)
    const rows = result?.all || (await db.transactions.where('[user_id+date]').between([user.id, range.from], [user.id, range.to], true, true)
      .filter((t) => !t.deleted_at && !t.purged_at && (type === 'all' || t.type === type) && (!f.account || t.account_id === f.account || t.to_account_id === f.account) && (!f.category || t.category_id === f.category)
        && (!needle || [t.payee, t.notes].join(' ').toLowerCase().includes(needle))).toArray());
    await exportTransactionsCsv(rows, { accounts, cats });
    toast(`Exported ${rows.length} transaction${rows.length === 1 ? '' : 's'}`);
  }

  return (
    <div>
      <PageHeader title="Transactions" actions={<>
        <button className="btn-soft btn-sm" onClick={exportCsv}><Download size={16} /> <span className="hidden sm:inline">Export CSV</span></button>
        <button className="btn-primary btn-sm hidden lg:inline-flex" onClick={() => openAdd('expense')}><Plus size={16} /> Add</button>
      </>} />

      <div className="sticky top-14 lg:top-0 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 py-2 bg-paper/90 dark:bg-night/90 backdrop-blur space-y-3">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search transactions</span>
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 muted" aria-hidden />
            <input className="input pl-10" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search merchant, note, #tag, amount" />
          </label>
          <button className="btn-soft px-3 relative" onClick={() => setShowFilters(true)} aria-label="Filters and sorting">
            <SlidersHorizontal size={18} />
            {activeFilters.length > 0 && <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-info text-white text-[11px] grid place-items-center">{activeFilters.length}</span>}
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {TYPES.map(([v, l]) => <button key={v} className={`chip shrink-0 ${type === v ? 'chip-on' : ''}`} onClick={() => { setType(v); setLimit(PAGE); }} aria-pressed={type === v}>{l}</button>)}
          {activeFilters.map(([label, clear]) => (
            <button key={label} className="chip shrink-0 border-info text-info" onClick={clear} aria-label={`Remove filter ${label}`}>{label} <X size={14} /></button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {!result ? (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="skeleton h-14" />)}</div>
        ) : result.rows.length === 0 ? (
          <div className="card">
            {dq || activeFilters.length || type !== 'all'
              ? <EmptyState art="chart" title="No matching transactions" body="Try a different search or clear some filters." />
              : <EmptyState art="receipt" title="No transactions yet" body="Start tracking your money. Your first entry takes a few seconds." action={<button className="btn-primary" onClick={() => openAdd('expense')}><Plus size={18} /> Add transaction</button>} />}
          </div>
        ) : groups ? (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.date} className="card p-1.5 sm:p-2">
                <div className="flex justify-between px-3 pt-2 pb-1 text-[13px]">
                  <h2 className="font-semibold font-sans">{friendlyDate(g.date)}</h2>
                  <span className="muted money">{formatMoney(g.net, currency, { sign: true })}</span>
                </div>
                {g.items.map((t) => <TransactionItem key={t.id} tx={t} accounts={accounts} cats={cats} onClick={openEdit} focusAccountId={f.account || null} />)}
              </section>
            ))}
          </div>
        ) : (
          <div className="card p-1.5 sm:p-2">
            {result.rows.map((t) => <TransactionItem key={t.id} tx={t} accounts={accounts} cats={cats} onClick={openEdit} focusAccountId={f.account || null} />)}
          </div>
        )}
        {result?.more && <div className="flex justify-center mt-5"><button className="btn-soft" onClick={() => setLimit((l) => l + PAGE)}>Show more</button></div>}
      </div>

      <Sheet open={showFilters} onClose={() => setShowFilters(false)} title="Filter and sort" footer={
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => setF({ range: 'all', from: '', to: '', account: '', category: '', tag: '', sort: 'newest' })}>Clear all</button>
          <button className="btn-primary flex-1" onClick={() => setShowFilters(false)}>Show results</button>
        </div>}>
        <div className="space-y-5">
          <Field label="Date">
            <div className="flex flex-wrap gap-2">{RANGE_OPTIONS.map(([v, l]) => <button key={v} className={`chip ${f.range === v ? 'chip-on' : ''}`} onClick={() => setF({ ...f, range: v })}>{l}</button>)}</div>
            {f.range === 'custom' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <input type="date" aria-label="From date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
                <input type="date" aria-label="To date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
              </div>
            )}
          </Field>
          <Field label="Account" htmlFor="f-acc">
            <select id="f-acc" className="input" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
              <option value="">All accounts</option>
              {(accountsList || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived_at ? ' (archived)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Category" htmlFor="f-cat">
            <select id="f-cat" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="">All categories</option>
              <optgroup label="Expense">{cats?.all.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{cats.label(c.id)}</option>)}</optgroup>
              <optgroup label="Income">{cats?.all.filter((c) => c.kind === 'income').map((c) => <option key={c.id} value={c.id}>{cats.label(c.id)}</option>)}</optgroup>
            </select>
          </Field>
          <Field label="Tag" htmlFor="f-tag"><input id="f-tag" className="input" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="#school" /></Field>
          <Field label="Sort by">
            <div className="flex flex-wrap gap-2">{SORTS.map(([v, l]) => <button key={v} className={`chip ${f.sort === v ? 'chip-on' : ''}`} onClick={() => setF({ ...f, sort: v })}>{l}</button>)}</div>
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
