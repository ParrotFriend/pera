import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ChevronRight, X } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { useAccounts, useBalances, useCategories } from '../hooks/useData.js';
import { PageHeader, Field, useToast } from '../components/ui.jsx';
import { IconTile } from '../components/Icon.jsx';
import { Donut } from '../components/Charts.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import { useBudgetStatuses, BudgetCard } from './Budgets.jsx';
import * as R from '../services/reports.js';
import { debtTotals } from '../services/calc.js';
import { download } from '../services/exporter.js';
import { formatMoney, toPlain } from '../lib/money.js';
import { toLocalDate, rangeFor, shiftMonth, endOfMonth, startOfMonth, monthLabel, friendlyDate, parseLocalDate } from '../lib/dates.js';

const RANGES = [['month', 'This month'], ['lastMonth', 'Last month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['custom', 'Custom']];
const UNITS = [['auto', 'Auto'], ['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']];

function resolveRange(key, custom) {
  const today = toLocalDate();
  if (key === '3m') return { from: shiftMonth(today, -2), to: endOfMonth(today) };
  if (key === 'custom') return { from: custom.from || startOfMonth(today), to: custom.to || today };
  return rangeFor(key, today);
}

export default function Reports() {
  const { currency } = useApp();
  const data = useBalances();
  const cats = useCategories();
  const accountsList = useAccounts();
  const budgets = useBudgetStatuses();
  const toast = useToast();
  const [rangeKey, setRangeKey] = useState('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [unitKey, setUnitKey] = useState('auto');
  const [accountId, setAccountId] = useState('');
  const [tag, setTag] = useState('');
  const [focusCat, setFocusCat] = useState(null);
  const range = resolveRange(rangeKey, custom);
  const validRange = range.from <= range.to;

  const view = useMemo(() => {
    if (!data || !cats || !validRange) return null;
    const txs = R.applyFilters(data.txs, { accountId: accountId || null, tag });
    const unit = unitKey === 'auto' ? R.autoUnit(range.from, range.to) : unitKey;
    const ov = R.overview(txs, range.from, range.to, accountId || null);
    const cash = R.cashflowSeries(txs, range.from, range.to, unit, accountId || null);
    const expenseRows = R.categoryBreakdown(txs, cats.all, range.from, range.to, 'expense');
    const incomeRows = R.categoryBreakdown(txs, cats.all, range.from, range.to, 'income');
    const accounts = R.accountBreakdown(accountId ? data.accounts.filter((a) => a.id === accountId) : data.accounts, data.txs, range.from, range.to);
    return { ov, cash, unit, expenseRows, incomeRows, accounts, txs, debt: debtTotals(data.debts, data.txs) };
  }, [data, cats, range.from, range.to, unitKey, accountId, tag, validRange]);

  if (!data || !cats) return <div className="skeleton h-64" />;
  const fmt = (v) => formatMoney(v, currency);
  const singleMonth = range.from === startOfMonth(range.from) && range.to === endOfMonth(range.from);
  const title = singleMonth ? monthLabel(range.from) : `${friendlyDate(range.from)} – ${friendlyDate(range.to)}`;

  function exportCsv() {
    const csv = R.reportCsv({ title: `Pera report · ${title}`, from: range.from, to: range.to, cash: view.cash, expenseRows: view.expenseRows, incomeRows: view.incomeRows, catLabel: (id) => cats.label(id), fmt: (v) => toPlain(v).replace(/,/g, '') });
    download(`pera-report-${range.from}-to-${range.to}.csv`, csv, 'text/csv;charset=utf-8');
    toast('Report exported');
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle={title} actions={view && <button className="btn-soft btn-sm" onClick={exportCsv}><Download size={16} /> <span className="hidden sm:inline">Export CSV</span></button>} />

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {RANGES.map(([v, l]) => <button key={v} className={`chip shrink-0 ${rangeKey === v ? 'chip-on' : ''}`} aria-pressed={rangeKey === v} onClick={() => setRangeKey(v)}>{l}</button>)}
        </div>
        {rangeKey === 'custom' && (
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <input type="date" aria-label="From date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <input type="date" aria-label="To date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 max-w-2xl">
          <select aria-label="Group by" className="input" value={unitKey} onChange={(e) => setUnitKey(e.target.value)}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select aria-label="Account" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {(accountsList || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input aria-label="Tag" className="input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="#tag" />
        </div>
      </div>

      {!validRange ? <p className="mt-6 text-sm text-loss">The start date must be before the end date.</p> : !view ? null : !view.ov.cur.count && !view.ov.prev.count ? (
        <div className="card mt-5"><EmptyState art="chart" title="Nothing to report yet" body="Reports fill in as you record income and expenses for this period." /></div>
      ) : (
        <div className="space-y-5 mt-5">
          {/* Headline numbers */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Summary">
            <Stat label="Income" value={fmt(view.ov.cur.income)} change={view.ov.change.income} prev={view.ov.prev.income} fmt={fmt} good="up" tone="in" />
            <Stat label="Expenses" value={fmt(view.ov.cur.expenses)} change={view.ov.change.expenses} prev={view.ov.prev.expenses} fmt={fmt} good="down" />
            <Stat label="Net cash flow" value={formatMoney(view.ov.cur.net, currency, { sign: true })} change={view.ov.change.net} prev={view.ov.prev.net} fmt={fmt} good="up" tone={view.ov.cur.net >= 0 ? 'in' : 'out'} />
            <Stat label="Saved from income" value={view.ov.savingsRate == null ? '—' : `${view.ov.savingsRate.toFixed(1)}%`} note={view.ov.prevSavingsRate == null ? null : `Before: ${view.ov.prevSavingsRate.toFixed(1)}%`} />
          </section>
          <p className="text-[12.5px] muted -mt-2">Compared with {friendlyDate(view.ov.prevRange.from)} – {friendlyDate(view.ov.prevRange.to)}. Transfers and loans are not counted as income or expenses.</p>

          {/* Monthly summary (Sec 35) */}
          {singleMonth && (
            <section className="card p-5" aria-labelledby="sum-h">
              <h2 id="sum-h" className="text-base font-semibold">{monthLabel(range.from)} summary</h2>
              <dl className="mt-3 grid sm:grid-cols-2 gap-x-8 text-[14.5px] divide-y sm:divide-y-0 divide-ink-100/70 dark:divide-night-line">
                <Row k="Income" v={fmt(view.ov.cur.income)} />
                <Row k="Expenses" v={fmt(view.ov.cur.expenses)} />
                <Row k="Net" v={formatMoney(view.ov.cur.net, currency, { sign: true })} />
                <Row k="Top spending category" v={view.expenseRows[0] ? `${cats.label(view.expenseRows[0].category_id)} (${fmt(view.expenseRows[0].total)})` : '—'} />
                <Row k="Highest expense" v={view.ov.highest ? `${fmt(view.ov.highest.amount)}${view.ov.highest.payee ? ` · ${view.ov.highest.payee}` : ''}` : '—'} />
                <Row k={`Expenses vs ${monthLabel(view.ov.prevRange.from)}`} v={`${fmt(view.ov.prev.expenses)} → ${formatMoney(view.ov.change.expenses, currency, { sign: true })}`} />
              </dl>
            </section>
          )}

          {/* Cash flow chart */}
          <section className="card p-5" aria-labelledby="cf-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="cf-h" className="text-base font-semibold">Income vs expenses</h2>
              <div className="flex gap-3 text-[12px] muted">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-gain" />Income</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-ink dark:bg-slate-300" />Expenses</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-info" />Net</span>
              </div>
            </div>
            <CashFlowChart series={view.cash} fmt={fmt} />
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Expenses by category */}
            <section className="card p-5" aria-labelledby="ec-h">
              <h2 id="ec-h" className="text-base font-semibold">Expenses by category</h2>
              {!view.expenseRows.length ? <p className="text-sm muted mt-2">No expenses in this period.</p> : (
                <>
                  <div className="flex justify-center my-4">
                    <Donut total={view.ov.cur.expenses} currency={currency} segments={view.expenseRows.filter((r) => r.total > 0).map((r) => ({ id: r.category_id || 'none', label: cats.label(r.category_id), value: r.total, color: cats.byId.get(r.category_id)?.color || '#7A809B' }))} />
                  </div>
                  <CategoryTable rows={view.expenseRows} cats={cats} fmt={fmt} onPick={setFocusCat} />
                </>
              )}
            </section>
            {/* Income by category */}
            <section className="card p-5" aria-labelledby="ic-h">
              <h2 id="ic-h" className="text-base font-semibold">Income by category</h2>
              {!view.incomeRows.length ? <p className="text-sm muted mt-2">No income in this period.</p> : <div className="mt-3"><CategoryTable rows={view.incomeRows} cats={cats} fmt={fmt} onPick={setFocusCat} /></div>}
            </section>
          </div>

          {focusCat && <CategoryDetail id={focusCat} cats={cats} txs={view.txs} fmt={fmt} range={range} onClose={() => setFocusCat(null)} />}

          {/* Accounts */}
          <section className="card p-5" aria-labelledby="acc-h">
            <h2 id="acc-h" className="text-base font-semibold">Accounts</h2>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm min-w-[520px]">
                <thead><tr className="muted text-left"><th className="py-2 font-medium">Account</th><th className="py-2 font-medium text-right">Start</th><th className="py-2 font-medium text-right">In</th><th className="py-2 font-medium text-right">Out</th><th className="py-2 font-medium text-right">End</th></tr></thead>
                <tbody>
                  {view.accounts.map((r) => (
                    <tr key={r.account.id} className="border-t border-ink-100/70 dark:border-night-line">
                      <td className="py-2.5"><Link to={`/accounts/${r.account.id}`} className="flex items-center gap-2 hover:underline"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.account.color }} />{r.account.name}</Link></td>
                      <td className="py-2.5 text-right money">{fmt(r.opening)}</td>
                      <td className="py-2.5 text-right money amount-in">+{fmt(r.moneyIn)}</td>
                      <td className="py-2.5 text-right money">−{fmt(r.moneyOut)}</td>
                      <td className="py-2.5 text-right money font-semibold">{fmt(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Budgets (current period) */}
            <section className="card p-5" aria-labelledby="rb-h">
              <div className="flex items-center justify-between"><h2 id="rb-h" className="text-base font-semibold">Budgets right now</h2><Link to="/budgets" className="text-sm muted inline-flex items-center">Open <ChevronRight size={16} /></Link></div>
              {budgets?.length ? <div className="divide-y divide-ink-100/70 dark:divide-night-line mt-1">{budgets.map(({ budget, st }) => <BudgetCard key={budget.id} compact budget={budget} st={st} cats={cats} currency={currency} onClick={() => {}} />)}</div>
                : <p className="text-sm muted mt-2">No budgets yet.</p>}
            </section>
            {/* Utang */}
            <section className="card p-5" aria-labelledby="ru-h">
              <div className="flex items-center justify-between"><h2 id="ru-h" className="text-base font-semibold">Utang</h2><Link to="/utang" className="text-sm muted inline-flex items-center">Open <ChevronRight size={16} /></Link></div>
              <dl className="mt-2 text-[14.5px] divide-y divide-ink-100/70 dark:divide-night-line">
                <Row k="Owed to you" v={fmt(view.debt.receivable)} />
                <Row k="You owe" v={fmt(view.debt.payable)} />
                <Row k="Overdue" v={String(view.debt.overdue)} />
              </dl>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, change, prev, fmt, good, tone, note }) {
  const hasChange = change != null && prev != null;
  const positive = hasChange && (good === 'up' ? change >= 0 : change <= 0);
  return (
    <div className="card p-4">
      <p className="text-sm muted">{label}</p>
      <p className={`money text-xl font-semibold mt-1 ${tone === 'in' ? 'amount-in' : ''}`}>{value}</p>
      {hasChange && change !== 0 && <p className={`text-[12px] mt-0.5 ${positive ? 'text-gain dark:text-gain-dark' : 'text-loss dark:text-loss-dark'}`}>{change > 0 ? '▲' : '▼'} {fmt(Math.abs(change))} vs before</p>}
      {hasChange && change === 0 && <p className="text-[12px] mt-0.5 muted">Same as before</p>}
      {note && <p className="text-[12px] mt-0.5 muted">{note}</p>}
    </div>
  );
}

const Row = ({ k, v }) => <div className="flex justify-between gap-4 py-2"><dt className="muted">{k}</dt><dd className="money text-right">{v}</dd></div>;

function CategoryTable({ rows, cats, fmt, onPick }) {
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const c = cats.byId.get(r.category_id);
        return (
          <li key={r.category_id || 'none'}>
            <button onClick={() => r.category_id && onPick(r.category_id)} className="w-full flex items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-ink-50/70 dark:hover:bg-night-line/60">
              <IconTile name={c?.icon} color={c?.color} size={32} icon={15} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{cats.label(r.category_id)}</span>
                <span className="block text-[12px] muted">{r.count} transaction{r.count === 1 ? '' : 's'} · avg {fmt(r.avg)}</span>
              </span>
              <span className="text-right">
                <span className="block money text-sm font-semibold">{fmt(r.total)}</span>
                <span className="block text-[11.5px] muted">{r.pct.toFixed(1)}%</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Category analytics (Sec 80): totals, average, count, largest, 6-month trend, budget use. */
function CategoryDetail({ id, cats, txs, fmt, range, onClose }) {
  const c = cats.byId.get(id);
  const rows = R.categoryBreakdown(txs, cats.all, range.from, range.to, c?.kind || 'expense');
  const r = rows.find((x) => x.category_id === id);
  const trend = R.categoryTrend(txs, cats.all, id, 6, range.to);
  const max = Math.max(1, ...trend.map((t) => t.total));
  return (
    <section className="card p-5" aria-labelledby="cd-h">
      <div className="flex items-center gap-3">
        <IconTile name={c?.icon} color={c?.color} />
        <h2 id="cd-h" className="text-base font-semibold flex-1">{cats.label(id)}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close category details"><X size={18} /></button>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
        <div><dt className="muted">Total</dt><dd className="money font-semibold">{fmt(r?.total || 0)}</dd></div>
        <div><dt className="muted">Average</dt><dd className="money font-semibold">{fmt(r?.avg || 0)}</dd></div>
        <div><dt className="muted">Transactions</dt><dd className="font-semibold">{r?.count || 0}</dd></div>
        <div><dt className="muted">Largest</dt><dd className="money font-semibold">{r?.largest ? fmt(r.largest.amount) : '—'}</dd></div>
      </dl>
      <p className="text-sm muted mt-5 mb-2">Last 6 months</p>
      <div className="flex items-end gap-2 h-28" role="img" aria-label={`${cats.label(id)} monthly totals`}>
        {trend.map((t) => (
          <div key={t.from} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <div className="w-full rounded-t-md" style={{ height: `${Math.max(2, (Math.max(0, t.total) / max) * 100)}%`, background: c?.color || '#7A809B' }} title={`${t.label}: ${fmt(t.total)}`} />
            <span className="text-[11px] muted">{t.label}</span>
          </div>
        ))}
      </div>
      <Link to={`/transactions?category=${id}`} className="text-sm underline underline-offset-2 mt-4 inline-block">See these transactions</Link>
    </section>
  );
}

/** Bars for income/expenses per period, with a net line. */
function CashFlowChart({ series, fmt }) {
  const [tip, setTip] = useState(null);
  const H = 180, pad = 8;
  const max = Math.max(1, ...series.map((s) => Math.max(s.income, s.expenses)));
  const minNet = Math.min(0, ...series.map((s) => s.net));
  const scale = (v) => H - pad - ((v - minNet) / (max - minNet || 1)) * (H - pad * 2);
  const w = 100 / Math.max(1, series.length);
  const zero = scale(0);
  const line = series.map((s, i) => `${i * w + w / 2},${scale(s.net)}`).join(' ');
  const labelEvery = Math.ceil(series.length / 8);
  return (
    <div className="relative mt-4">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }} role="img" aria-label="Income, expenses and net per period">
        <line x1="0" x2="100" y1={zero} y2={zero} className="stroke-ink-100 dark:stroke-night-line" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        {series.map((s, i) => (
          <g key={s.key} onMouseEnter={() => setTip(s)} onMouseLeave={() => setTip(null)} onClick={() => setTip(s)}>
            <rect x={i * w} y="0" width={w} height={H} fill="transparent" />
            <rect x={i * w + w * 0.12} y={scale(s.income)} width={w * 0.36} height={Math.max(0, zero - scale(s.income))} className="fill-gain" rx="0.4" />
            <rect x={i * w + w * 0.52} y={scale(Math.max(0, s.expenses))} width={w * 0.36} height={Math.max(0, zero - scale(Math.max(0, s.expenses)))} className="fill-ink dark:fill-slate-300" rx="0.4" />
          </g>
        ))}
        {series.length > 1 && <polyline points={line} fill="none" className="stroke-info" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
      </svg>
      <div className="flex text-[11px] muted mt-1">
        {series.map((s, i) => <span key={s.key} className="text-center truncate" style={{ width: `${w}%` }}>{i % labelEvery === 0 ? s.label : ''}</span>)}
      </div>
      {tip && (
        <div className="absolute top-0 right-0 rounded-lg bg-ink text-white dark:bg-white dark:text-ink text-[12px] px-3 py-2 pointer-events-none">
          <div className="font-semibold">{tip.label}{tip.from !== tip.to ? ` – ${parseLocalDate(tip.to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</div>
          <div>In {fmt(tip.income)} · Out {fmt(tip.expenses)}</div>
          <div>Net {fmt(tip.net)}</div>
        </div>
      )}
    </div>
  );
}