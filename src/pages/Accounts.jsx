import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronRight, Archive } from 'lucide-react';
import { useApp } from '../services/app.jsx';
import { useBalances } from '../hooks/useData.js';
import { PageHeader } from '../components/ui.jsx';
import { IconTile } from '../components/Icon.jsx';
import { EmptyState } from '../components/Illustrations.jsx';
import AccountForm from '../components/AccountForm.jsx';
import { ACCOUNT_TYPES, isLiabilityType } from '../services/defaults.js';
import { formatMoney } from '../lib/money.js';

export default function Accounts() {
  const { currency } = useApp();
  const data = useBalances();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  if (!data) return <div className="skeleton h-64" />;
  const { accounts, balances, totals } = data;
  const active = accounts.filter((a) => !a.archived_at);
  const archived = accounts.filter((a) => a.archived_at);
  const assets = active.filter((a) => !isLiabilityType(a.type));
  const liabilities = active.filter((a) => isLiabilityType(a.type));

  return (
    <div>
      <PageHeader title="Accounts" subtitle="Where your money is kept" actions={<button className="btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={16} /> Add account</button>} />
      {!accounts.length ? (
        <div className="card"><EmptyState title="Add your first account" body="Cash, GCash, Maya, your bank — each keeps its own balance." action={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={18} /> Add account</button>} /></div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Summary label="Assets" value={totals.assets} currency={currency} />
            <Summary label="Liabilities" value={-totals.liabilities} currency={currency} />
            <Summary label="Net worth" value={totals.netWorth} currency={currency} strong />
          </div>
          <Group title="Money you have" accounts={assets} balances={balances} total={assets.reduce((s, a) => s + (balances.get(a.id) || 0), 0)} currency={currency} />
          {liabilities.length > 0 && <Group title="Money you owe" accounts={liabilities} balances={balances} total={liabilities.reduce((s, a) => s + (balances.get(a.id) || 0), 0)} currency={currency} />}
          {archived.length > 0 && (
            <div>
              <button className="btn-ghost btn-sm" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}><Archive size={16} /> {showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>
              {showArchived && <div className="mt-2"><Group title="Archived" accounts={archived} balances={balances} currency={currency} muted /></div>}
            </div>
          )}
        </div>
      )}
      <AccountForm open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function Summary({ label, value, currency, strong }) {
  return (
    <div className={`rounded-2xl p-3.5 sm:p-4 ${strong ? 'bg-ink text-white dark:bg-[#18214A]' : 'card'}`}>
      <p className={`text-[12.5px] ${strong ? 'text-white/60' : 'muted'}`}>{label}</p>
      <p className="money text-base sm:text-xl font-semibold mt-1 truncate">{formatMoney(value, currency)}</p>
    </div>
  );
}

function Group({ title, accounts, balances, total, currency, muted }) {
  return (
    <section className="card p-1.5 sm:p-2" aria-label={title}>
      <div className="flex justify-between px-3 pt-2 pb-1 text-[13px]">
        <h2 className="font-semibold font-sans">{title}</h2>
        {total != null && <span className="money muted">{formatMoney(total, currency)}</span>}
      </div>
      {accounts.map((a) => {
        const b = balances.get(a.id) || 0;
        const type = ACCOUNT_TYPES.find((t) => t.value === a.type);
        const low = a.low_balance_threshold != null && b < a.low_balance_threshold;
        return (
          <Link key={a.id} to={`/accounts/${a.id}`} className={`flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-ink-50/70 dark:hover:bg-night-line/60 ${muted ? 'opacity-70' : ''}`}>
            <IconTile name={a.icon} color={a.color} />
            <span className="flex-1 min-w-0">
              <span className="block font-medium truncate">{a.name}</span>
              <span className="block text-[12.5px] muted">{type?.label}{a.include_in_total === false ? ' · not in total' : ''}{low ? ' · below alert' : ''}</span>
            </span>
            <span className={`money font-semibold ${b < 0 ? 'text-loss' : ''}`}>{formatMoney(b, a.currency)}</span>
            <ChevronRight size={18} className="muted" aria-hidden />
          </Link>
        );
      })}
    </section>
  );
}
