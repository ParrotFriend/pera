import { useMemo } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Plus, TriangleAlert, ChevronRight } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { useBalances, useCategories } from '../hooks/useData.js';
import { summarize, dailySeries } from '../services/calc.js';
import { isLiabilityType } from '../services/defaults.js';
import { formatMoney, percent } from '../lib/money.js';
import { rangeFor, monthLabel, toLocalDate, friendlyDate } from '../lib/dates.js';
import { Donut, DailyBars, ShareBar } from '../components/Charts.jsx';
import TransactionItem from '../components/TransactionItem.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import { IconTile } from '../components/Icon.jsx';
import { useBudgetStatuses, BudgetCard } from './Budgets.jsx';
import { UpcomingBillsCard } from './Bills.jsx';
import { debtTotals } from '../services/calc.js';

export default function Dashboard() {
  const { currency } = useApp();
  const { openAdd, openEdit } = useOutletContext();
  const data = useBalances();
  const cats = useCategories();
  const today = toLocalDate();
  const month = rangeFor('month', today);
  const last = rangeFor('lastMonth', today);
  // Compare like with like: the 1st to today's day-of-month in the previous month.
  const lastSame = { from: last.from, to: `${last.from.slice(0, 8)}${today.slice(8)}` > last.to ? last.to : `${last.from.slice(0, 8)}${today.slice(8)}` };

  const budgets = useBudgetStatuses();
  const view = useMemo(() => {
    if (!data || !cats) return null;
    const { accounts, txs, balances, totals } = data;
    const cur = summarize(txs, month);
    const prev = summarize(txs, lastSame);
    const accMap = new Map(accounts.map((a) => [a.id, a]));
    const assetParts = accounts.filter((a) => !isLiabilityType(a.type) && !a.archived_at && a.include_in_total !== false)
      .map((a) => ({ id: a.id, label: a.name, value: Math.max(0, balances.get(a.id) || 0), color: a.color, balance: balances.get(a.id) || 0 }))
      .sort((a, b) => b.value - a.value);
    const catSegments = [...cur.byCategory.entries()].filter(([, v]) => v > 0)
      .map(([id, v]) => ({ id: id || 'none', label: cats.label(id), value: v, color: cats.byId.get(id)?.color || '#7A809B', icon: cats.byId.get(id)?.icon }))
      .sort((a, b) => b.value - a.value);
    const recent = [...txs].sort((a, b) => (b.date + b.time + b.created_at).localeCompare(a.date + a.time + a.created_at)).slice(0, 8);
    const lowBalance = accounts.filter((a) => !a.archived_at && a.low_balance_threshold != null && (balances.get(a.id) || 0) < a.low_balance_threshold);
    const monthTx = txs.filter((t) => t.date >= month.from && t.date <= month.to && t.type === 'expense');
    const largest = monthTx.reduce((m, t) => (!m || t.amount > m.amount ? t : m), null);

    // Factual insights only — derived from the user's own records.
    const insights = [];
    if (prev.expenses > 0 && cur.expenses > 0) {
      const diff = cur.expenses - prev.expenses;
      insights.push(`You've spent ${formatMoney(Math.abs(diff), currency)} ${diff >= 0 ? 'more' : 'less'} than over the same days last month (${formatMoney(prev.expenses, currency)}).`);
    }
    if (catSegments[0]) insights.push(`${catSegments[0].label} is your top spending category this month at ${percent(catSegments[0].value, cur.expenses)}% of expenses.`);
    if (largest) insights.push(`Your largest expense this month was ${formatMoney(largest.amount, accMap.get(largest.account_id)?.currency || currency)}${largest.payee ? ` at ${largest.payee}` : ''} ${/^(Today|Yesterday)$/.test(friendlyDate(largest.date)) ? friendlyDate(largest.date).toLowerCase() : 'on ' + friendlyDate(largest.date)}.`);
    if (cur.income > 0) insights.push(`You kept ${percent(Math.max(0, cur.net), cur.income)}% of this month's income so far.`);

    const debt = debtTotals(data.debts, txs, today);
    const overall = budgets?.find((x) => x.budget.scope === 'overall' && x.budget.period === 'monthly');
    if (overall) insights.push(`You have ${formatMoney(Math.max(0, overall.st.remaining), currency)} remaining in your monthly budget.`);
    const hot = budgets?.filter((x) => x.st.level !== 'ok').length || 0;
    if (hot) insights.push(`${hot} budget${hot > 1 ? 's are' : ' is'} at or near the limit.`);
    return { debt, accounts, accMap, totals, cur, prev, assetParts, catSegments, recent, lowBalance, insights, series: dailySeries(txs, month.from, month.to), hasTx: txs.length > 0 };
  }, [data, cats, budgets, month.from, month.to, lastSame.from, lastSame.to, currency]);

  if (!view) return <DashboardSkeleton />;
  const { totals, cur, prev } = view;
  const delta = (a, b) => (b ? Math.round(((a - b) * 100) / b) : null);

  return (
    <div className="space-y-5">
      <div>
        <p className="muted text-sm">{monthLabel(today)}</p>
        <h1 className="text-2xl sm:text-[28px] font-semibold">Your money</h1>
      </div>

      {view.lowBalance.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-2xl bg-warn-soft dark:bg-warn/15 px-4 py-3 text-sm" role="status">
          <TriangleAlert size={18} className="text-warn mt-0.5 shrink-0" aria-hidden />
          <span>Your <strong>{a.name}</strong> balance is below your alert of {formatMoney(a.low_balance_threshold, a.currency)}.</span>
        </div>
      ))}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Hero: how much, and where it is */}
        <section className="lg:col-span-3 rounded-3xl bg-ink text-white p-5 sm:p-7 relative overflow-hidden dark:bg-[#18214A]" aria-label="Total balance">
          <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/[0.04]" aria-hidden />
          <p className="text-white/60 text-sm">Total balance</p>
          <p className="money text-[44px] sm:text-[56px] font-semibold leading-none mt-2 tracking-tight">{formatMoney(totals.cash, currency)}</p>
          <div className="mt-6"><ShareBar parts={view.assetParts} /></div>
          <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
            {view.assetParts.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link to={`/accounts/${p.id}`} className="flex items-center gap-2 min-w-0 rounded-lg hover:bg-white/5 -mx-1 px-1 py-0.5">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-white/60 truncate">{p.label}</span>
                    <span className="block money text-[15px] font-medium">{formatMoney(p.balance, currency)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {(totals.liabilities > 0 || totals.receivable > 0 || totals.payable > 0) && (
            <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {totals.receivable > 0 && <span className="text-white/60">Owed to you <span className="money text-white">{formatMoney(totals.receivable, currency)}</span></span>}
              {(totals.liabilities + totals.payable) > 0 && <span className="text-white/60">You owe <span className="money text-white">{formatMoney(totals.liabilities + totals.payable, currency)}</span></span>}
              <span className="text-white/60">Net worth <span className="money text-white">{formatMoney(totals.netWorth, currency)}</span></span>
            </div>
          )}
          {!view.accounts.length && <Link to="/accounts" className="btn-sm btn bg-white text-ink mt-4">Add your first account</Link>}
        </section>

        {/* This month */}
        <section className="lg:col-span-2 grid grid-cols-2 gap-3 content-start" aria-label="This month">
          <Stat label="Income" value={cur.income} tone="in" icon={ArrowDownLeft} currency={currency} change={delta(cur.income, prev.income)} />
          <Stat label="Expenses" value={cur.expenses} tone="out" icon={ArrowUpRight} currency={currency} change={delta(cur.expenses, prev.expenses)} invert />
          <div className="card col-span-2 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm muted">Net cash flow this month</span>
              <span className={`money text-xl font-semibold ${cur.net >= 0 ? 'amount-in' : 'text-loss'}`}>{formatMoney(cur.net, currency, { sign: true })}</span>
            </div>
            <p className="text-[13px] mt-1">
              {cur.net >= 0
                ? <>You kept <strong className="money">{formatMoney(cur.net, currency)}</strong> of what you earned this month.</>
                : <>You spent <strong className="money">{formatMoney(-cur.net, currency)}</strong> more than you earned this month.</>}
            </p>
            {[['Money in · income', cur.income, 'bg-gain'], ['Money out · expenses', cur.expenses, 'bg-loss']].map(([label, value, color]) => (
              <div key={label} className="mt-3">
                <div className="flex justify-between text-[13px]"><span className="muted">{label}</span><span className="money font-medium">{formatMoney(value, currency)}</span></div>
                <div className="mt-1 h-2.5 rounded-full bg-ink-50 dark:bg-night-line overflow-hidden">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${(value * 100) / Math.max(cur.income, cur.expenses, 1)}%` }} />
                </div>
              </div>
            ))}
            <p className="text-[12px] muted mt-3">Transfers between your own accounts are not counted. <Link to="/reports" className="underline underline-offset-2">Daily chart in Reports</Link></p>
          </div>
        </section>
      </div>

      {!view.hasTx ? (
        <div className="card">
          <EmptyState art="receipt" title="Start tracking your money" body="Record your first expense or income. Balances, charts and insights update instantly."
            action={<button className="btn-primary" onClick={() => openAdd('expense')}><Plus size={18} /> Add transaction</button>} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <section className="card p-5 lg:col-span-2" aria-labelledby="spend-h">
            <h2 id="spend-h" className="text-base font-semibold">Where your money went</h2>
            <p className="text-[12.5px] muted">This month, after refunds</p>
            {view.catSegments.length ? (
              <div className="mt-4 flex flex-col sm:flex-row lg:flex-col 2xl:flex-row items-center gap-5">
                <Donut segments={view.catSegments} total={cur.expenses} currency={currency} />
                <ul className="w-full min-w-0 flex-1 space-y-2.5">
                  {view.catSegments.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex items-center gap-2.5">
                      <IconTile name={s.icon} color={s.color} size={30} icon={15} />
                      <span className="flex-1 min-w-0 text-sm truncate">{s.label}</span>
                      <span className="text-right">
                        <span className="block money text-sm font-medium">{formatMoney(s.value, currency)}</span>
                        <span className="block text-[11.5px] muted">{percent(s.value, cur.expenses)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="text-sm muted mt-6">No expenses recorded this month yet.</p>}
          </section>

          <section className="card p-2 sm:p-3 lg:col-span-3" aria-labelledby="recent-h">
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <h2 id="recent-h" className="text-base font-semibold">Recent transactions</h2>
              <Link to="/transactions" className="text-sm font-medium muted hover:text-ink dark:hover:text-white inline-flex items-center">See all <ChevronRight size={16} /></Link>
            </div>
            <div>{view.recent.map((t) => <TransactionItem key={t.id} tx={t} accounts={view.accMap} cats={cats} onClick={openEdit} />)}</div>
          </section>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3" aria-labelledby="bud-h">
          <div className="flex items-center justify-between">
            <h2 id="bud-h" className="text-base font-semibold">Budgets</h2>
            <Link to="/budgets" className="text-sm font-medium muted hover:text-ink dark:hover:text-white inline-flex items-center">{budgets?.length ? 'All budgets' : 'Set a budget'} <ChevronRight size={16} /></Link>
          </div>
          {budgets?.length ? (
            <div className="divide-y divide-ink-100/70 dark:divide-night-line mt-1">
              {budgets.slice(0, 4).map(({ budget, st }) => <Link key={budget.id} to="/budgets" className="block"><BudgetCard compact budget={budget} st={st} cats={cats} currency={currency} /></Link>)}
            </div>
          ) : <p className="text-sm muted mt-2">Set a monthly limit for everything or for categories like Food, and Pera will warn you before you go over.</p>}
        </section>
        <section className="card p-5 lg:col-span-2" aria-labelledby="utang-h">
          <div className="flex items-center justify-between">
            <h2 id="utang-h" className="text-base font-semibold">Utang</h2>
            <Link to="/utang" className="text-sm font-medium muted hover:text-ink dark:hover:text-white inline-flex items-center">Open <ChevronRight size={16} /></Link>
          </div>
          {view.debt.receivable || view.debt.payable ? (
            <dl className="mt-3 space-y-3">
              <div className="flex justify-between items-baseline"><dt className="text-sm muted">May utang sa iyo{view.debt.peopleOwing ? ` · ${view.debt.peopleOwing} tao` : ''}</dt><dd className="money text-lg font-semibold amount-in">{formatMoney(view.debt.receivable, currency)}</dd></div>
              <div className="flex justify-between items-baseline"><dt className="text-sm muted">Utang mo</dt><dd className="money text-lg font-semibold">{formatMoney(view.debt.payable, currency)}</dd></div>
              {view.debt.overdue > 0 && <p className="text-sm text-loss dark:text-loss-dark font-medium">{view.debt.overdue} overdue — check Utang.</p>}
            </dl>
          ) : <p className="text-sm muted mt-2">Record money you lend or borrow and track partial payments.</p>}
        </section>
      </div>

      <UpcomingBillsCard />

      {view.insights.length > 0 && (
        <section className="card p-5" aria-labelledby="ins-h">
          <h2 id="ins-h" className="text-base font-semibold">This month at a glance</h2>
          <ul className="mt-3 space-y-2 text-[14.5px] leading-relaxed">
            {view.insights.map((s) => <li key={s} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-info shrink-0" />{s}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone, icon: I, currency, change, invert }) {
  const good = change == null ? null : invert ? change <= 0 : change >= 0;
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm muted">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${tone === 'in' ? 'bg-gain-soft text-gain dark:bg-gain/15' : 'bg-ink-50 text-ink dark:bg-night-line dark:text-slate-200'}`}><I size={16} aria-hidden /></span>
        {label}
      </div>
      <p className={`money text-[22px] font-semibold mt-2 ${tone === 'in' ? 'amount-in' : ''}`}>{formatMoney(value, currency)}</p>
      {change != null && (
        <p className={`text-[12px] mt-0.5 ${good ? 'text-gain dark:text-gain-dark' : 'text-loss dark:text-loss-dark'}`}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% vs same days last month
        </p>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-40" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="skeleton h-64 lg:col-span-3 rounded-3xl" />
        <div className="skeleton h-64 lg:col-span-2 rounded-3xl" />
      </div>
    </div>
  );
}
