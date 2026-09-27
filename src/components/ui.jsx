import { forwardRef, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { X, CircleCheck, TriangleAlert, Info } from 'lucide-react';
import { currencyInfo, formatMoney, parseMoney, toEditable } from '../lib/money.js';

// ---------- Sheet / Modal (bottom sheet on mobile, centered dialog on desktop) ----------
export function Sheet({ open, onClose, title, children, footer, wide = false, labelledBy }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        const list = [...f].filter((el) => !el.disabled && el.offsetParent !== null);
        if (!list.length) return;
        if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector('[data-autofocus]')?.focus() || ref.current?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px] anim-fade" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy || titleId}
        className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col bg-white dark:bg-night-card rounded-t-3xl sm:rounded-3xl shadow-2xl anim-sheet outline-none`}>
        <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-ink-100 dark:bg-night-line" />
        {title && (
          <div className="flex items-center justify-between px-5 pt-3 sm:pt-5 pb-2">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>
        )}
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-ink-100/70 dark:border-night-line px-5 py-3 safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Confirm dialog ----------
const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Sheet open={!!state} onClose={() => close(false)} title={state?.title}
        footer={<div className="flex gap-2 justify-end">
          <button className="btn-ghost" onClick={() => close(false)}>{state?.cancelLabel || 'Cancel'}</button>
          <button className={state?.danger ? 'btn-danger' : 'btn-primary'} data-autofocus onClick={() => close(true)}>{state?.confirmLabel || 'Confirm'}</button>
        </div>}>
        <div className="text-[15px] muted leading-relaxed">{state?.message}</div>
      </Sheet>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Toasts ----------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((message, { tone = 'success', action, duration = 3500 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x.slice(-1), { id, message, tone, action }]); // at most 2 on screen
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), duration);
  }, []);
  const icons = { success: CircleCheck, error: TriangleAlert, info: Info };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-24 lg:bottom-auto lg:top-6 w-[min(92vw,420px)] space-y-2" role="status" aria-live="polite">
        {items.map((t) => {
          const I = icons[t.tone] || Info;
          return (
            <div key={t.id} className="anim-sheet flex items-center gap-3 rounded-2xl bg-ink text-white dark:bg-white dark:text-ink px-4 py-3 shadow-lift">
              <I size={18} className={t.tone === 'error' ? 'text-loss-dark dark:text-loss' : t.tone === 'success' ? 'text-gain-dark dark:text-gain' : ''} />
              <span className="text-sm flex-1">{t.message}</span>
              {t.action && <button className="text-sm font-semibold underline underline-offset-2" onClick={t.action.onClick}>{t.action.label}</button>}
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Form field ----------
export function Field({ label, error, children, hint, htmlFor }) {
  return (
    <div>
      {label && <label className="field-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="mt-1.5 text-[13px] muted">{hint}</p> : null}
    </div>
  );
}

// ---------- Money input: text in, integer minor units out ----------
export const MoneyInput = forwardRef(function MoneyInput({ value, onChange, currency = 'PHP', id, error, large = false, allowNegative = false, autoFocus, ...rest }, ref) {
  const c = currencyInfo(currency);
  const [text, setText] = useState(value == null ? '' : toEditable(Math.abs(value), c.decimals));
  const [neg, setNeg] = useState(value < 0);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value == null ? '' : toEditable(Math.abs(value), c.decimals));
      setNeg(value < 0);
      last.current = value;
    }
  }, [value, c.decimals]);
  const emit = (t, n) => {
    const parsed = parseMoney(t, c.decimals);
    const v = parsed == null ? null : n ? -parsed : parsed;
    last.current = v;
    onChange(v);
  };
  const onText = (e) => {
    let t = e.target.value.replace(/[^\d.,]/g, '').replace(/,/g, '');
    const parts = t.split('.');
    if (parts.length > 2) t = parts[0] + '.' + parts.slice(1).join('');
    if (c.decimals === 0) t = t.replace('.', '');
    else if (parts[1]?.length > c.decimals) return; // don't accept extra decimals
    setText(t);
    emit(t, neg);
  };
  const display = (() => {
    if (!text) return '';
    const [w, f] = text.split('.');
    const grouped = w ? Number(w).toLocaleString('en-US') : '0';
    return f !== undefined ? `${grouped}.${f}` : grouped;
  })();
  return (
    <div className={`flex items-center rounded-2xl border bg-white dark:bg-night ${error ? 'border-loss' : 'border-ink-100 dark:border-night-line'} focus-within:ring-2 focus-within:ring-ink-100 dark:focus-within:ring-ink-700 ${large ? 'h-20 px-4' : 'h-11 px-3.5'}`}>
      {allowNegative && (
        <button type="button" onClick={() => { setNeg(!neg); emit(text, !neg); }} className="mr-2 rounded-lg px-2 py-1 text-sm font-semibold bg-ink-50 dark:bg-night-line" aria-label={neg ? 'Amount is negative, tap to make positive' : 'Amount is positive, tap to make negative'}>
          {neg ? '−' : '+'}
        </button>
      )}
      <span className={`muted ${large ? 'text-3xl' : 'text-[15px]'} mr-1.5 font-display`}>{c.symbol}</span>
      <input ref={ref} id={id} inputMode="decimal" autoComplete="off" autoFocus={autoFocus} value={display} onChange={onText} placeholder={c.decimals ? '0.00' : '0'}
        aria-invalid={!!error} className={`w-full bg-transparent outline-none money ${large ? 'text-4xl font-semibold' : 'text-[15px]'} placeholder:text-ink-200 dark:placeholder:text-slate-600`} {...rest} />
    </div>
  );
});

// ---------- Amount display (never rely on color alone: sign is always shown) ----------
export function Amount({ value, currency = 'PHP', kind, className = '', sign = true }) {
  const tone = kind === 'in' ? 'amount-in' : kind === 'neutral' ? 'muted' : 'amount-out';
  const shown = kind === 'out' ? -Math.abs(value) : kind === 'in' ? Math.abs(value) : value;
  return <span className={`money ${tone} ${className}`}>{formatMoney(shown, currency, { sign: sign && kind === 'in' })}</span>;
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-xl bg-ink-50 dark:bg-night p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`h-9 rounded-lg text-sm font-semibold transition-colors ${value === v ? 'bg-white text-ink shadow-sm dark:bg-night-card dark:text-white' : 'text-ink-400 dark:text-slate-400'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <header className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0 flex items-center gap-2">
        {back}
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-[28px] font-semibold leading-tight truncate">{title}</h1>
          {subtitle && <p className="muted text-sm mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}

export function ProgressBar({ value, max, tone = 'ink', label }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = { ink: 'bg-ink dark:bg-slate-200', gain: 'bg-gain', warn: 'bg-warn', loss: 'bg-loss' }[tone];
  return (
    <div className="h-2 rounded-full bg-ink-50 dark:bg-night-line overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
