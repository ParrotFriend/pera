import { useState } from 'react';
import { formatMoney } from '../lib/money.js';
import { parseLocalDate } from '../lib/dates.js';

/** Donut for category breakdown. segments: [{id,label,value,color}] (value in minor units, > 0) */
export function Donut({ segments, total, currency, size = 168, centerLabel = 'Spent' }) {
  const [hover, setHover] = useState(null);
  const r = 60, c = 2 * Math.PI * r;
  let offset = 0;
  const active = segments.find((s) => s.id === hover);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={`${centerLabel} by category`}>
        <circle cx="80" cy="80" r={r} fill="none" strokeWidth="18" className="stroke-ink-50 dark:stroke-night-line" />
        {segments.map((s) => {
          const len = total ? (s.value / total) * c : 0;
          const el = (
            <circle key={s.id} cx="80" cy="80" r={r} fill="none" stroke={s.color} strokeWidth={hover === s.id ? 22 : 18}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)"
              onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} style={{ transition: 'stroke-width .15s' }}>
              <title>{`${s.label}: ${formatMoney(s.value, currency)}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
        <span className="text-[12px] muted truncate max-w-full">{active ? active.label : centerLabel}</span>
        <span className="money text-lg font-semibold">{formatMoney(active ? active.value : total, currency)}</span>
      </div>
    </div>
  );
}

/** Daily income/expense bars for a month. series: [{date, income, expenses}] */
export function DailyBars({ series, from, to, currency, height = 140 }) {
  const days = [];
  for (let d = parseLocalDate(from); d <= parseLocalDate(to); d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push(series.find((s) => s.date === key) || { date: key, income: 0, expenses: 0 });
  }
  const max = Math.max(1, ...days.map((d) => Math.max(d.income, d.expenses)));
  const w = 100 / days.length;
  const [tip, setTip] = useState(null);
  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Daily income and expenses this month">
        {days.map((d, i) => {
          const hi = (d.income / max) * (height - 16);
          const he = (Math.max(0, d.expenses) / max) * (height - 16);
          return (
            <g key={d.date} onMouseEnter={() => setTip(d)} onMouseLeave={() => setTip(null)}>
              <rect x={i * w} y="0" width={w} height={height} fill="transparent" />
              <rect x={i * w + w * 0.14} y={height - hi} width={w * 0.34} height={hi} rx="0.6" className="fill-gain" />
              <rect x={i * w + w * 0.52} y={height - he} width={w * 0.34} height={he} rx="0.6" className="fill-ink dark:fill-slate-300" />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] muted mt-1"><span>{parseLocalDate(from).getDate()}</span><span>{parseLocalDate(to).getDate()}</span></div>
      {tip && (
        <div className="absolute top-0 right-0 rounded-lg bg-ink text-white dark:bg-white dark:text-ink text-[12px] px-2.5 py-1.5 pointer-events-none">
          <div className="font-semibold">{parseLocalDate(tip.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
          <div>In {formatMoney(tip.income, currency)} · Out {formatMoney(tip.expenses, currency)}</div>
        </div>
      )}
    </div>
  );
}

/** Where your money is: one bar split by account share. */
export function ShareBar({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <div className="h-3 rounded-full bg-white/15" />;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/10 gap-[2px] anim-bar">
      {parts.map((p, i) => (
        <div key={p.id} title={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color, animationDelay: `${i * 60}ms` }} className="h-full first:rounded-l-full last:rounded-r-full" />
      ))}
    </div>
  );
}
