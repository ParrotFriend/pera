import { useState } from 'react';
import { Eye, EyeOff, Check, X } from 'lucide-react';

// Rules for NEW passwords (sign up, reset, change). Login accepts whatever the account already has.
export const PASSWORD_RULES = [
  ['length', 'At least 8 characters', (p) => p.length >= 8],
  ['upper', 'A capital letter (A–Z)', (p) => /[A-Z]/.test(p)],
  ['lower', 'A small letter (a–z)', (p) => /[a-z]/.test(p)],
  ['number', 'A number (0–9)', (p) => /\d/.test(p)],
  ['special', 'A special character (e.g. ! @ # $ % & *)', (p) => /[^A-Za-z0-9\s]/.test(p)]
];
export const MAX_PASSWORD = 72; // Supabase/bcrypt limit

/** List of unmet rule labels (empty = strong enough). */
export function passwordProblems(p = '') {
  const out = PASSWORD_RULES.filter(([, , test]) => !test(p)).map(([, label]) => label);
  if (p.length > MAX_PASSWORD) out.push(`At most ${MAX_PASSWORD} characters`);
  if (/^\s|\s$/.test(p)) out.push('No spaces at the start or end');
  return out;
}

/** "Still needed: a capital letter (A–Z), a number (0–9)." — keeps the examples' casing. */
export function problemText(problems) {
  return `Still needed: ${problems.map((x) => x[0].toLowerCase() + x.slice(1)).join(', ')}.`;
}

function strength(p) {
  const met = PASSWORD_RULES.filter(([, , test]) => test(p)).length + (p.length >= 12 ? 1 : 0);
  if (!p) return null;
  if (met <= 2) return ['Weak', 'bg-loss', 25];
  if (met <= 4) return ['Okay', 'bg-warn', 55];
  if (met === 5) return ['Strong', 'bg-gain', 85];
  return ['Very strong', 'bg-gain', 100];
}

/**
 * Password input with a show/hide button.
 * showRules → live checklist + strength bar (for new passwords).
 */
export default function PasswordField({ id, label, value, onChange, autoComplete = 'current-password', error, showRules = false, placeholder, autoFocus }) {
  const [visible, setVisible] = useState(false);
  const s = showRules ? strength(value) : null;
  return (
    <div>
      {label && <label className="field-label" htmlFor={id}>{label}</label>}
      <div className="relative">
        <input id={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} autoFocus={autoFocus} placeholder={placeholder}
          className={`input pr-12 ${error ? 'input-error' : ''}`} value={value} onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error} aria-describedby={showRules ? `${id}-rules` : undefined} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
          className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn w-9 h-9">
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {showRules && (
        <div id={`${id}-rules`} className="mt-2.5">
          {s && (
            <div className="flex items-center gap-2 mb-2">
              <div className="h-1.5 flex-1 rounded-full bg-ink-50 dark:bg-night-line overflow-hidden"><div className={`h-full rounded-full ${s[1]}`} style={{ width: `${s[2]}%` }} /></div>
              <span className="text-[12px] font-medium w-20 text-right">{s[0]}</span>
            </div>
          )}
          <ul className="space-y-1" aria-label="Password requirements">
            {PASSWORD_RULES.map(([key, text, test]) => {
              const ok = test(value);
              return (
                <li key={key} className={`flex items-center gap-2 text-[12.5px] ${ok ? 'text-gain dark:text-gain-dark' : 'muted'}`}>
                  {ok ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
                  <span>{text}<span className="sr-only">{ok ? ' — done' : ' — missing'}</span></span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Confirm password" field that shows whether both match. */
export function ConfirmPasswordField({ id, value, onChange, original, error }) {
  const matches = value && value === original;
  return (
    <div>
      <PasswordField id={id} label="Type it again" value={value} onChange={onChange} autoComplete="new-password" error={error} />
      {value && !error && (
        <p className={`mt-1.5 text-[12.5px] flex items-center gap-1.5 ${matches ? 'text-gain dark:text-gain-dark' : 'text-loss dark:text-loss-dark'}`}>
          {matches ? <><Check size={14} /> Passwords match</> : <><X size={14} /> Passwords don’t match yet</>}
        </p>
      )}
    </div>
  );
}