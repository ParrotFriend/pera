import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, ReceiptText, Wallet, Tags, Trash2, History, Settings, Ellipsis, Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, X, PieChart, HandCoins, CalendarClock, ChartColumn } from 'lucide-react';
import { useToast } from './ui.jsx';
import { runSchedules } from '../services/schedules.js';
import { useRegisterSW } from 'virtual:pwa-register/react';
import SyncBadge from './SyncBadge.jsx';
import TransactionForm from './TransactionForm.jsx';
import { Logo } from './Logo.jsx';

const NAV = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/transactions', 'Transactions', ReceiptText],
  ['/accounts', 'Accounts', Wallet],
  ['/budgets', 'Budgets', PieChart],
  ['/utang', 'Utang', HandCoins],
  ['/bills', 'Bills', CalendarClock],
  ['/reports', 'Reports', ChartColumn],
  ['/categories', 'Categories', Tags],
  ['/activity', 'Activity log', History],
  ['/trash', 'Trash', Trash2],
  ['/settings', 'Settings', Settings]
];

export default function Layout() {
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(null); // { type } | { editing }
  const [dial, setDial] = useState(false);
  const loc = useLocation();

  // PWA shortcuts: /?add=expense | /?add=income
  useEffect(() => {
    const add = params.get('add');
    if (['expense', 'income', 'transfer'].includes(add)) {
      setForm({ type: add });
      params.delete('add'); params.delete('source');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);
  useEffect(() => setDial(false), [loc.pathname]);

  // Recurring automation: record due items when the app opens, when it comes back to the screen, and hourly.
  const toast = useToast();
  useEffect(() => {
    const run = () => runSchedules().then((n) => { if (n) toast(`${n} recurring transaction${n > 1 ? 's' : ''} recorded`); }).catch(() => {});
    run();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(run, 60 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [toast]);

  const navigate = useNavigate();
  const open = (type, prefill = null) => { setDial(false); setForm({ type, prefill }); };
  // Loan/repayment rows are managed on the Utang screen, not in the generic editor.
  const openEdit = (tx) => (tx.type === 'debt' ? navigate(`/utang?debt=${tx.debt_id}`) : setForm({ editing: tx }));
  const ctx = { openAdd: open, openEdit };

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-ink-100/70 dark:border-night-line bg-white/60 dark:bg-night-card/40 px-4 py-5">
        <div className="px-2 mb-6"><Logo /></div>
        <button className="btn-primary w-full mb-5" onClick={() => open('expense')}><Plus size={18} /> Add transaction</button>
        <nav className="space-y-0.5" aria-label="Main">
          {NAV.map(([to, label, I]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 h-10 text-[14.5px] font-medium transition-colors ${isActive ? 'bg-ink text-white dark:bg-white dark:text-ink' : 'text-ink-600 hover:bg-ink-50 dark:text-slate-300 dark:hover:bg-night-line'}`}>
              <I size={18} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-4"><SyncBadge /></div>
      </aside>

      <div className="flex-1 lg:pl-64 min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-paper/85 dark:bg-night/85 backdrop-blur border-b border-transparent" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <Logo small />
          <SyncBadge compact />
        </div>
        <UpdateBanner />
        <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 pt-4 lg:pt-8 pb-32 lg:pb-12">
          <Outlet context={ctx} />
        </main>
      </div>

      {/* Mobile: floating quick-add + bottom nav (Dashboard, Transactions, Budget, Accounts, More) */}
      <button onClick={() => setDial((d) => !d)} aria-expanded={dial} aria-label={dial ? 'Close quick add' : 'Quick add'}
        className="lg:hidden fixed z-40 right-4 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] h-14 w-14 rounded-2xl bg-ink text-white dark:bg-white dark:text-ink shadow-lift flex items-center justify-center transition-transform active:scale-95">
        {dial ? <X size={26} /> : <Plus size={28} />}
      </button>
      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-night-card/95 backdrop-blur border-t border-ink-100/70 dark:border-night-line safe-bottom">
        <div className="grid grid-cols-5 items-end h-16 px-1">
          <MobileTab to="/" label="Home" I={LayoutDashboard} />
          <MobileTab to="/transactions" label="Transactions" I={ReceiptText} />
          <MobileTab to="/budgets" label="Budget" I={PieChart} />
          <MobileTab to="/accounts" label="Accounts" I={Wallet} />
          <MobileTab to="/more" label="More" I={Ellipsis} />
        </div>
      </nav>
      {dial && (
        <div className="lg:hidden fixed inset-0 z-30" onClick={() => setDial(false)}>
          <div className="absolute inset-0 bg-ink-900/30 anim-fade" />
          <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] right-4 flex flex-col items-end gap-2.5 anim-sheet" onClick={(e) => e.stopPropagation()}>
            {[['transfer', 'Transfer', ArrowLeftRight, 'bg-info text-white'], ['income', 'Income', ArrowDownLeft, 'bg-gain text-white'], ['expense', 'Expense', ArrowUpRight, 'bg-white text-ink dark:bg-night-card dark:text-white']].map(([t, l, I, c]) => (
              <button key={t} onClick={() => open(t)} className={`flex items-center gap-2 rounded-2xl pl-3.5 pr-4 h-12 shadow-lift font-semibold text-sm ${c}`}>
                <I size={20} aria-hidden /> {l}
              </button>
            ))}
          </div>
        </div>
      )}

      <TransactionForm open={!!form} onClose={() => setForm(null)} initialType={form?.type || form?.editing?.type || 'expense'} editing={form?.editing || null} prefill={form?.prefill || null} />
    </div>
  );
}

function MobileTab({ to, label, I }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium ${isActive ? 'text-ink dark:text-white' : 'text-ink-400 dark:text-slate-500'}`}>
      <I size={22} aria-hidden /> {label}
    </NavLink>
  );
}

function UpdateBanner() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update(), 60 * 60 * 1000); }
  });
  if (!needRefresh) return null;
  return (
    <div className="mx-4 lg:mx-10 mt-3 flex items-center gap-3 rounded-2xl bg-info-soft text-ink dark:bg-info/15 dark:text-slate-100 px-4 py-3 text-sm" role="status">
      <span className="flex-1">A new version of Pera is ready.</span>
      <button className="btn-sm btn-primary" onClick={() => updateServiceWorker(true)}>Update now</button>
      <button className="btn-sm btn-ghost" onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  );
}

export { NAV };
