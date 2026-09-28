import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AppProvider, useApp } from './services/app.jsx';
import { ToastProvider, ConfirmProvider } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Accounts from './pages/Accounts.jsx';
import AccountDetail from './pages/AccountDetail.jsx';

// Less-used screens are split into separate chunks (all precached for offline use).
const Categories = lazy(() => import('./pages/Categories.jsx'));
const Budgets = lazy(() => import('./pages/Budgets.jsx'));
const Debts = lazy(() => import('./pages/Debts.jsx'));
const Bills = lazy(() => import('./pages/Bills.jsx'));
const Trash = lazy(() => import('./pages/Trash.jsx'));
const Activity = lazy(() => import('./pages/Activity.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Sync = lazy(() => import('./pages/Sync.jsx'));
const More = lazy(() => import('./pages/More.jsx'));
const Auth = lazy(() => import('./pages/Auth.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));

function Gate() {
  const { auth, user, settings } = useApp();
  if (auth.loading || (user && !settings)) return <Splash />;
  if (!user || auth.recovery) return <Suspense fallback={<Splash />}><Auth /></Suspense>;
  if (!settings.onboarded) return <Suspense fallback={<Splash />}><Onboarding /></Suspense>;
  return (
    <Suspense fallback={<div className="skeleton h-64 m-6" />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="accounts/:id" element={<AccountDetail />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="utang" element={<Debts />} />
          <Route path="bills" element={<Bills />} />
          <Route path="categories" element={<Categories />} />
          <Route path="trash" element={<Trash />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<Settings />} />
          <Route path="sync" element={<Sync />} />
          <Route path="more" element={<More />} />
          <Route path="*" element={<div className="card p-8 text-center"><p className="text-lg font-semibold">Page not found</p><Link to="/" className="btn-soft mt-4">Go to dashboard</Link></div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function Splash() {
  return <div className="min-h-screen grid place-items-center" aria-busy="true"><div className="h-10 w-10 rounded-full border-4 border-ink-100 border-t-ink dark:border-night-line dark:border-t-white animate-spin" /></div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Gate />
          </ConfirmProvider>
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  );
}
export { Navigate };
