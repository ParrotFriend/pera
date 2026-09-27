// Transaction dates are stored as LOCAL calendar dates ("YYYY-MM-DD") + local time ("HH:mm").
// A ₱250 lunch on Sept 27 stays on Sept 27 regardless of timezone conversion.
// System timestamps (created_at, updated_at) are ISO UTC strings.

const pad = (n) => String(n).padStart(2, '0');

export function toLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toLocalTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function isValidLocalDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  return toLocalDate(parseLocalDate(s)) === s;
}
export function addDays(s, n) {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}
export function startOfMonth(s = toLocalDate()) {
  return s.slice(0, 8) + '01';
}
export function endOfMonth(s = toLocalDate()) {
  const d = parseLocalDate(startOfMonth(s));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toLocalDate(d);
}
export function shiftMonth(s, n) {
  const d = parseLocalDate(startOfMonth(s));
  d.setMonth(d.getMonth() + n);
  return toLocalDate(d);
}

export const RANGE_OPTIONS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'],
  ['lastMonth', 'Last month'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom']
];

/** Named ranges → { from, to } inclusive local dates. */
export function rangeFor(key, today = toLocalDate()) {
  const d = parseLocalDate(today);
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'week': { const dow = (d.getDay() + 6) % 7; const from = addDays(today, -dow); return { from, to: addDays(from, 6) }; }
    case 'month': return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'lastMonth': { const s = shiftMonth(today, -1); return { from: s, to: endOfMonth(s) }; }
    case 'year': return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
    default: return { from: '0000-01-01', to: '9999-12-31' };
  }
}

export function friendlyDate(s, today = toLocalDate()) {
  if (s === today) return 'Today';
  if (s === addDays(today, -1)) return 'Yesterday';
  const sameYear = s.slice(0, 4) === today.slice(0, 4);
  return parseLocalDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function monthLabel(s) {
  return parseLocalDate(s).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
