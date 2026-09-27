// All money is stored as INTEGER minor units (centavos for PHP). Never floats.
// ₱100.50 -> 10050

export const CURRENCIES = {
  PHP: { code: 'PHP', symbol: '₱', decimals: 2, name: 'Philippine peso' },
  USD: { code: 'USD', symbol: '$', decimals: 2, name: 'US dollar' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, name: 'Euro' },
  SGD: { code: 'SGD', symbol: 'S$', decimals: 2, name: 'Singapore dollar' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, name: 'Japanese yen' }
};

export function currencyInfo(code = 'PHP') {
  return CURRENCIES[code] || CURRENCIES.PHP;
}

/**
 * Parse user text like "1,500.5" into integer minor units using string math only.
 * Returns null for anything that isn't a valid non-negative amount.
 */
export function parseMoney(input, decimals = 2) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/^S\$/, '').replace(/[,\s₱$€¥]/g, '');
  if (s === '') return null;
  const re = decimals > 0 ? new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`) : /^\d+$/;
  if (!re.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const n = Number(whole) * 10 ** decimals + (decimals ? Number(fracPadded) : 0);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/** Integer minor units -> "1,500.50" (no symbol) using integer division, never float math. */
export function toPlain(minor, decimals = 2) {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const base = 10 ** decimals;
  const whole = Math.floor(abs / base);
  const frac = abs % base;
  const wholeStr = whole.toLocaleString('en-US');
  const out = decimals ? `${wholeStr}.${String(frac).padStart(decimals, '0')}` : wholeStr;
  return neg ? `-${out}` : out;
}

/** Minor units -> editable string without grouping, e.g. 150050 -> "1500.50" */
export function toEditable(minor, decimals = 2) {
  return toPlain(minor, decimals).replace(/,/g, '');
}

/** Format for display: ₱1,500.50 or −₱1,500.50 */
export function formatMoney(minor, code = 'PHP', { sign = false } = {}) {
  const c = currencyInfo(code);
  const prefix = minor < 0 ? '−' : sign && minor > 0 ? '+' : '';
  return `${prefix}${c.symbol}${toPlain(Math.abs(minor), c.decimals)}`;
}

/** Percent to one decimal place. */
export function percent(part, whole) {
  if (!whole) return 0;
  return Math.round((part * 1000) / whole) / 10;
}
