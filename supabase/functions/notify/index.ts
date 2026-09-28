// @ts-nocheck — plain JS-style code; skip strict type checking on deploy
// Pera — "notify" Edge Function (Supabase / Deno).
// Runs every hour (pg_cron). For each user with notifications on, works out which reminders are due
// in THEIR timezone, sends each one once (notification_log), and cleans up dead subscriptions.
// Also handles { test: true } from the app to send a test notification to the signed-in user.
//
// Secrets needed (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

// =============================== pure logic (tested) ===============================
const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const startOfMonth = (s) => s.slice(0, 8) + '01';
const endOfMonth = (s) => { const d = parse(startOfMonth(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return fmtDate(d); };
const shiftMonth = (s, n) => { const d = parse(startOfMonth(s)); d.setUTCMonth(d.getUTCMonth() + n); return fmtDate(d); };
const weekStart = (s) => addDays(s, -((parse(s).getUTCDay() + 6) % 7));
const SYMBOL = { PHP: '₱', USD: '$', EUR: '€', SGD: 'S$', JPY: '¥' };
export function money(minor, currency = 'PHP') {
  const dec = currency === 'JPY' ? 0 : 2;
  const abs = Math.abs(minor), base = 10 ** dec;
  const whole = Math.floor(abs / base).toLocaleString('en-US');
  return `${minor < 0 ? '−' : ''}${SYMBOL[currency] || ''}${dec ? `${whole}.${String(abs % base).padStart(2, '0')}` : whole}`;
}
const niceDate = (s) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Local date + hour in the user's timezone. */
export function localNow(timeZone = 'Asia/Manila', now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Same schedule math as the app (src/services/schedules.js).
const STEP = { daily: [1, 'day'], weekly: [7, 'day'], biweekly: [14, 'day'], monthly: [1, 'month'], quarterly: [3, 'month'], yearly: [12, 'month'] };
export function occurrenceAt(s, n) {
  const [count, unit] = s.frequency === 'custom' ? [Math.max(1, s.interval || 1) * (s.interval_unit === 'week' ? 7 : 1), s.interval_unit === 'month' ? 'month' : 'day'] : STEP[s.frequency];
  if (unit === 'day') return addDays(s.start_date, n * count);
  const start = parse(s.start_date);
  const total = start.getUTCMonth() + n * count;
  const y = start.getUTCFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${pad(m + 1)}-${pad(Math.min(start.getUTCDate(), dim))}`;
}
export function occurrencesBetween(s, from, to) {
  const out = [];
  const min = s.effective_from && s.effective_from > from ? s.effective_from : from;
  for (let n = 0; n < 20000; n++) {
    if (s.max_count && n >= s.max_count) break;
    const d = occurrenceAt(s, n);
    if (d > to || (s.end_date && d > s.end_date)) break;
    if (d >= min) out.push(d);
  }
  return out;
}

// Same budget math as the app (src/services/calc.js budgetStatus).
function budgetPeriod(b, date) {
  if (b.period === 'custom') return { from: b.start_date, to: b.end_date };
  if (b.period === 'weekly') { const f = weekStart(date); return { from: f, to: addDays(f, 6) }; }
  return { from: startOfMonth(date), to: endOfMonth(date) };
}
function prevPeriod(b, p) {
  if (b.period === 'weekly') return { from: addDays(p.from, -7), to: addDays(p.from, -1) };
  const from = shiftMonth(p.from, -1); return { from, to: endOfMonth(from) };
}
function budgetSpent(b, txs, categories, from, to) {
  let set = null;
  if (b.scope === 'category') { set = new Set(b.category_ids || []); for (const c of categories) if (c.parent_id && set.has(c.parent_id)) set.add(c.id); }
  let spent = 0;
  for (const t of txs) {
    if (t.deleted_at || t.purged_at || t.date < from || t.date > to) continue;
    if (t.type !== 'expense' && t.type !== 'refund') continue;
    if (set && !set.has(t.category_id)) continue;
    if (t.type === 'refund' && !t.category_id) continue;
    spent += t.type === 'expense' ? t.amount : -t.amount;
  }
  return spent;
}
export function budgetStatus(b, txs, categories, today) {
  const period = budgetPeriod(b, today);
  let carried = 0;
  if (b.rollover && b.period !== 'custom') {
    const chain = []; let p = prevPeriod(b, period); const sp = budgetPeriod(b, b.start_date);
    for (let i = 0; i < 120 && p.to >= sp.from; i++) { chain.unshift(p); p = prevPeriod(b, p); }
    for (const q of chain) carried = Math.max(0, b.amount + carried - budgetSpent(b, txs, categories, q.from, q.to));
  }
  const limit = b.amount + carried;
  const spent = budgetSpent(b, txs, categories, period.from, period.to);
  const pct = limit > 0 ? (spent * 100) / limit : 0;
  let level = 'ok';
  if (spent > limit) level = 'exceeded'; else if (spent === limit && limit > 0) level = 'reached'; else if (pct >= (b.alert_at || 80)) level = 'warning';
  return { period, limit, spent, remaining: limit - spent, pct, level };
}

/**
 * Decide which notifications are due for one user right now.
 * data: { settings, schedules, scheduleTxs, debts, debtPayments, people, budgets, categories, spendTxs, accounts }
 * Returns [{ key, title, body, url }] — `key` makes each reminder send only once.
 */
export function dueNotifications(data, today) {
  const s = data.settings;
  const cur = s.currency || 'PHP';
  const out = [];
  const billDays = (s.bill_days && s.bill_days.length ? s.bill_days : [3, 1, 0]).map(Number);

  // Bills + "ask me first" recurring
  const paid = new Set(data.scheduleTxs.filter((t) => !t.deleted_at && !t.purged_at).map((t) => `${t.schedule_id}|${t.occurrence_date}`));
  for (const sc of data.schedules) {
    if (sc.deleted_at || sc.paused_at) continue;
    const isBill = sc.kind === 'bill';
    if (isBill ? !s.bills : (sc.auto || !s.recurring)) continue;
    const horizon = Math.max(0, ...billDays);
    for (const date of occurrencesBetween(sc, addDays(today, -8), addDays(today, horizon))) {
      if (paid.has(`${sc.id}|${date}`) || (sc.skipped || []).includes(date)) continue;
      const diff = daysBetween(today, date);
      const amt = sc.variable_amount ? '' : ` · ${money(sc.amount, cur)}`;
      if (diff >= 0 && billDays.includes(diff)) {
        out.push({ key: `sched:${sc.id}:${date}:${diff}`, url: '/bills',
          title: diff === 0 ? `${sc.name} is due today` : diff === 1 ? `${sc.name} is due tomorrow` : `${sc.name} is due in ${diff} days`,
          body: `${isBill ? 'Bill' : 'Recurring'}${amt} · due ${niceDate(date)}` });
      } else if (diff === -1 || diff === -7) {
        out.push({ key: `sched:${sc.id}:${date}:over${-diff}`, url: '/bills', title: `${sc.name} is overdue`, body: `Was due ${niceDate(date)}${amt}. Tap to mark it paid or skip it.` });
      }
    }
  }

  // Utang with a due date
  if (s.debts) {
    const people = new Map(data.people.map((p) => [p.id, p]));
    for (const d of data.debts) {
      if (d.deleted_at || !d.due_date) continue;
      const paidAmt = data.debtPayments.filter((t) => t.debt_id === d.id && !t.deleted_at && !t.purged_at).reduce((a, t) => a + t.amount, 0);
      const remaining = d.amount - paidAmt - (d.forgiven_amount || 0);
      if (remaining <= 0) continue;
      const diff = daysBetween(today, d.due_date);
      if (![1, 0, -1, -7].includes(diff)) continue;
      const name = people.get(d.person_id)?.name || 'Someone';
      const toMe = d.direction === 'owed_to_me';
      const when = diff === 1 ? 'is due tomorrow' : diff === 0 ? 'is due today' : 'is overdue';
      out.push({ key: `debt:${d.id}:${d.due_date}:${diff}`, url: '/utang',
        title: toMe ? `${name}'s utang ${when}` : `Your utang to ${name} ${when}`,
        body: `${money(remaining, cur)} left${diff < 0 ? ` · was due ${niceDate(d.due_date)}` : ''}` });
    }
  }

  // Budgets: once per level per period
  if (s.budgets) {
    for (const b of data.budgets) {
      if (b.deleted_at || b.archived_at || (b.period === 'custom' && b.end_date < today)) continue;
      const st = budgetStatus(b, data.spendTxs, data.categories, today);
      if (st.level === 'ok') continue;
      const text = st.level === 'exceeded' ? `Your ${b.name} budget has been exceeded by ${money(-st.remaining, cur)}.`
        : st.level === 'reached' ? `Your ${b.name} budget has been reached.`
        : `You're approaching your ${b.name} budget — ${money(st.remaining, cur)} left (${Math.round(st.pct)}% used).`;
      out.push({ key: `budget:${b.id}:${st.period.from}:${st.level}`, url: '/budgets', title: 'Budget alert', body: text });
    }
  }

  // Low balance: at most once a week per account while it stays low
  if (s.low_balance) {
    for (const a of data.accounts) {
      if (a.deleted_at || a.archived_at || a.low_balance_threshold == null) continue;
      if (a.balance < a.low_balance_threshold) {
        out.push({ key: `low:${a.id}:${weekStart(today)}`, url: `/accounts/${a.id}`, title: `${a.name} balance is low`,
          body: `Your ${a.name} balance (${money(a.balance, a.currency || cur)}) is below your ${money(a.low_balance_threshold, a.currency || cur)} alert.` });
      }
    }
  }
  return out;
}

// =============================== server ===============================
const env = (k) => Deno.env.get(k) || '';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

async function sendTo(db, subs, payload) {
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 12 * 3600 });
      sent++;
      await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', sub.id);
    } catch (e) {
      // 404/410 = the browser unsubscribed or the app was uninstalled: forget this subscription
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('push_subscriptions').delete().eq('id', sub.id);
      else console.error('push failed', e?.statusCode || e?.message);
    }
  }
  return sent;
}

async function loadUserData(db, userId, settings, today) {
  const since = shiftMonth(today, -13);
  const q = (t, cols = '*') => db.from(t).select(cols).eq('user_id', userId);
  const [schedules, scheduleTxs, debts, debtPayments, people, budgets, categories, spendTxs, accounts] = await Promise.all([
    q('schedules').is('deleted_at', null),
    q('transactions', 'schedule_id, occurrence_date, deleted_at, purged_at').not('schedule_id', 'is', null),
    q('debts').is('deleted_at', null),
    q('transactions', 'debt_id, amount, deleted_at, purged_at').eq('debt_role', 'payment'),
    q('people', 'id, name'),
    q('budgets').is('deleted_at', null),
    q('categories', 'id, parent_id'),
    q('transactions', 'type, amount, date, category_id, deleted_at, purged_at').in('type', ['expense', 'refund']).gte('date', since),
    db.from('account_balances').select('*').eq('user_id', userId)
  ]);
  const all = [schedules, scheduleTxs, debts, debtPayments, people, budgets, categories, spendTxs, accounts];
  const failed = all.find((r) => r.error);
  if (failed) throw failed.error;
  return { settings, schedules: schedules.data, scheduleTxs: scheduleTxs.data, debts: debts.data, debtPayments: debtPayments.data, people: people.data, budgets: budgets.data, categories: categories.data, spendTxs: spendTxs.data, accounts: accounts.data };
}

async function handler(req) {
  if (req.method === 'OPTIONS') return json({ ok: true });
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  // Test notification for the signed-in user (called from Settings in the app).
  if (body.test) {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u, error } = await db.auth.getUser(token);
    if (error || !u?.user) return json({ error: 'Not signed in' }, 401);
    const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', u.user.id);
    const sent = await sendTo(db, subs || [], { title: 'Pera notifications are on ✓', body: 'This is a test. Bill, utang and budget reminders will appear like this.', url: '/settings' });
    return json({ sent, devices: subs?.length || 0 });
  }

  // Hourly run from pg_cron.
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'Forbidden' }, 403);
  const { data: settingsList, error } = await db.from('notification_settings').select('*').eq('enabled', true);
  if (error) return json({ error: 'settings' }, 500);
  let users = 0, sent = 0;
  for (const settings of settingsList || []) {
    try {
      const { date: today, hour } = localNow(settings.timezone || 'Asia/Manila');
      if (hour < (settings.send_hour ?? 8)) continue; // don't wake people up
      const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', settings.user_id);
      if (!subs?.length) continue;
      users++;
      const data = await loadUserData(db, settings.user_id, settings, today);
      for (const n of dueNotifications(data, today)) {
        // Claim the key first: if another run already sent it, the insert does nothing.
        const { data: claimed } = await db.from('notification_log').insert({ user_id: settings.user_id, key: n.key }).select('key').maybeSingle();
        if (!claimed) continue;
        sent += await sendTo(db, subs, { title: n.title, body: n.body, url: n.url, tag: n.key });
      }
    } catch (e) {
      console.error('user run failed', e?.message || e); // never log financial details
    }
  }
  return json({ users, sent });
}

if (!Deno.env.get('PERA_NO_SERVE')) Deno.serve(handler);