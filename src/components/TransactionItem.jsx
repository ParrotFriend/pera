import { ArrowLeftRight, Scale, Undo2, HandCoins } from 'lucide-react';
import { IconTile } from './Icon.jsx';
import { formatMoney } from '../lib/money.js';
import { useApp } from '../services/app.jsx';

/** One row in a transaction list. Sign and wording carry meaning, not just color. */
export default function TransactionItem({ tx, accounts, cats, onClick, focusAccountId = null }) {
  const { user } = useApp();
  const acc = accounts.get(tx.account_id);
  const to = accounts.get(tx.to_account_id);
  const cur = acc?.currency || 'PHP';
  let title, sub, amount, tone, tile;
  switch (tx.type) {
    case 'transfer': {
      const incoming = focusAccountId && tx.to_account_id === focusAccountId;
      title = `${acc?.name || '?'} → ${to?.name || '?'}`;
      sub = 'Transfer';
      amount = focusAccountId ? (incoming ? tx.amount : -tx.amount) : tx.amount;
      tone = focusAccountId ? (incoming ? 'amount-in' : 'amount-out') : 'muted';
      tile = <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-info-soft text-info dark:bg-info/15"><ArrowLeftRight size={18} aria-hidden /></span>;
      break;
    }
    case 'adjustment':
      title = tx.payee || 'Balance adjustment';
      sub = `Adjustment · ${acc?.name || ''}`;
      amount = tx.direction === 'out' ? -tx.amount : tx.amount;
      tone = 'muted';
      tile = <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-warn-soft text-warn dark:bg-warn/15"><Scale size={18} aria-hidden /></span>;
      break;
    case 'debt': {
      const payment = tx.debt_role === 'payment';
      const out = tx.direction === 'out';
      // out+principal = you lent; in+principal = you borrowed; in+payment = they paid you; out+payment = you paid
      title = payment ? (out ? `Bayad kay ${tx.payee}` : `Bayad ni ${tx.payee}`) : (out ? `Pautang kay ${tx.payee}` : `Utang kay ${tx.payee}`);
      sub = `Utang · ${acc?.name || ''}`;
      amount = out ? -tx.amount : tx.amount;
      tone = out ? 'amount-out' : 'amount-in';
      tile = <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-ink-50 text-ink-600 dark:bg-night-line dark:text-slate-300"><HandCoins size={18} aria-hidden /></span>;
      break;
    }
    case 'refund':
      title = tx.payee || 'Refund';
      sub = `Refund${tx.category_id ? ` · ${cats.label(tx.category_id)}` : ''} · ${acc?.name || ''}`;
      amount = tx.amount; tone = 'amount-in';
      tile = <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gain-soft text-gain dark:bg-gain/15"><Undo2 size={18} aria-hidden /></span>;
      break;
    default: {
      const c = cats.byId.get(tx.category_id);
      title = tx.payee || c?.name || (tx.type === 'income' ? 'Income' : 'Expense');
      sub = `${cats.label(tx.category_id)} · ${acc?.name || ''}`;
      amount = tx.type === 'income' ? tx.amount : -tx.amount;
      tone = tx.type === 'income' ? 'amount-in' : 'amount-out';
      tile = <IconTile name={c?.icon} color={c?.color} />;
    }
  }
  return (
    <button onClick={() => onClick?.(tx)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-ink-50/70 dark:hover:bg-night-line/60 transition-colors">
      {tile}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium truncate">{title}</span>
        <span className="block text-[12.5px] muted truncate">
          {sub}{tx.notes ? ` · ${tx.notes}` : ''}{tx.tags?.length ? ` · ${tx.tags.map((t) => '#' + t).join(' ')}` : ''}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className={`block money text-[15px] font-semibold ${tone}`}>{formatMoney(amount, cur, { sign: tx.type !== 'transfer' || !!focusAccountId })}</span>
        {tx.sync_status !== 'synced' && !user?.local && (
          <span className={`block text-[11px] ${tx.sync_status === 'conflict' ? 'text-loss' : 'muted'}`}>{tx.sync_status === 'conflict' ? 'Needs review' : 'Not synced yet'}</span>
        )}
      </span>
    </button>
  );
}
