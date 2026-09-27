// Lightweight inline SVG illustrations (no network, work offline, adapt to theme via currentColor).
export function WalletArt({ className = 'w-40 h-32' }) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden="true">
      <ellipse cx="100" cy="146" rx="70" ry="8" className="fill-ink-50 dark:fill-night-line" />
      <rect x="38" y="44" width="124" height="90" rx="16" className="fill-ink dark:fill-ink-600" />
      <rect x="50" y="28" width="84" height="40" rx="8" fill="#0E9F6E" transform="rotate(-8 92 48)" />
      <rect x="58" y="22" width="84" height="40" rx="8" fill="#34D399" transform="rotate(-2 100 42)" />
      <text x="100" y="48" textAnchor="middle" fontSize="18" fontWeight="700" fill="#0B5E43" fontFamily="system-ui">₱</text>
      <rect x="38" y="60" width="124" height="74" rx="16" className="fill-ink-700 dark:fill-ink-400" />
      <rect x="118" y="84" width="44" height="26" rx="10" className="fill-ink dark:fill-ink-600" />
      <circle cx="132" cy="97" r="5" fill="#F4F6FB" />
    </svg>
  );
}

export function ReceiptArt({ className = 'w-40 h-32' }) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden="true">
      <ellipse cx="100" cy="148" rx="60" ry="7" className="fill-ink-50 dark:fill-night-line" />
      <path d="M62 18h76v122l-9.5-7-9.5 7-9.5-7-9.5 7-9.5-7-9.5 7-9.5-7-9.5 7z" className="fill-white stroke-ink-100 dark:fill-night-card dark:stroke-night-line" strokeWidth="2" />
      <rect x="76" y="38" width="48" height="6" rx="3" className="fill-ink-100 dark:fill-night-line" />
      <rect x="76" y="56" width="30" height="5" rx="2.5" className="fill-ink-100 dark:fill-night-line" />
      <rect x="112" y="56" width="12" height="5" rx="2.5" fill="#D6334A" opacity=".6" />
      <rect x="76" y="70" width="34" height="5" rx="2.5" className="fill-ink-100 dark:fill-night-line" />
      <rect x="112" y="70" width="12" height="5" rx="2.5" fill="#0E9F6E" opacity=".6" />
      <rect x="76" y="94" width="48" height="8" rx="4" className="fill-ink dark:fill-slate-300" />
      <circle cx="148" cy="44" r="16" fill="#0E9F6E" />
      <path d="M141 44l5 5 9-10" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChartArt({ className = 'w-40 h-32' }) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden="true">
      <ellipse cx="100" cy="146" rx="70" ry="8" className="fill-ink-50 dark:fill-night-line" />
      <rect x="40" y="90" width="22" height="48" rx="6" className="fill-ink-100 dark:fill-night-line" />
      <rect x="72" y="66" width="22" height="72" rx="6" className="fill-ink-200 dark:fill-ink-600" />
      <rect x="104" y="46" width="22" height="92" rx="6" className="fill-ink dark:fill-slate-300" />
      <rect x="136" y="28" width="22" height="110" rx="6" fill="#0E9F6E" />
      <path d="M44 78 L82 56 L114 38 L150 18" stroke="#1C8FD1" strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="4 6" />
    </svg>
  );
}

export function EmptyState({ art = 'wallet', title, body, action }) {
  const Art = { wallet: WalletArt, receipt: ReceiptArt, chart: ChartArt }[art] || WalletArt;
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      <Art />
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      {body && <p className="muted text-sm mt-1 max-w-xs">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
