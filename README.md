# Pera — Budget & Money (Phase 1)

Offline-first personal finance PWA. React 18 + Vite + Tailwind, IndexedDB (Dexie) on the device, Supabase (Postgres + Auth) in the cloud.

**Phase 1 status (built and tested):** authentication, PWA (install, offline, updates, shortcuts), offline database + sync queue + conflict handling, accounts/wallets, transactions (income, expense, transfer, refund, adjustment), categories + subcategories, smart category suggestions, dashboard, search/filter/sort, account statements, reconciliation, soft delete + Trash, audit log, CSV export, JSON backup/restore, dark mode, onboarding.

**Not built yet (Phases 2–4):** budgets + alerts + rollover, bills, recurring transactions, notifications, full reports section, savings goals, debts/loans module, credit-card statement features, net-worth history chart, receipts/OCR, CSV import, Excel/PDF export, dashboard customization, financial calendar, admin area. No screen links to these — nothing in the app is a fake button.

---

## 1. Project structure

```
pera/
├─ index.html                 app shell, pre-paint theme, boot splash
├─ vite.config.js             Vite + PWA manifest + Workbox + vendor chunking + Vitest
├─ tailwind.config.js         design tokens (ink/paper/gain/loss/warn/info)
├─ .env.example
├─ supabase/001_schema.sql    tables, constraints, triggers, RLS
├─ scripts/make-icons.mjs     generates PWA icons from one SVG
├─ public/                    favicon, apple-touch-icon, icons/ (192, 512, maskable)
├─ tests/                     Vitest: money, accounting (Sec 87), sync + conflicts (Sec 88/73)
└─ src/
   ├─ main.jsx, App.jsx       entry, error boundary, routes, auth/onboarding gate
   ├─ lib/                    money.js (integer minor units), dates.js (local dates), id.js
   ├─ db/db.js                IndexedDB schema (Dexie)
   ├─ services/
   │  ├─ calc.js              PURE financial math (balances, totals, summaries, statements)
   │  ├─ ledger.js            all writes: validation + atomic record/outbox/audit
   │  ├─ sync.js              sync engine (push/pull/confirm/conflicts/backoff)
   │  ├─ remote.js            Supabase client + sync transport
   │  ├─ app.jsx              auth, settings, sync triggers, theme, PWA install hook
   │  ├─ exporter.js          CSV export, backup, restore
   │  └─ defaults.js          default categories, payee hints, account types
   ├─ hooks/useData.js        live queries (UI re-renders when IndexedDB changes)
   ├─ components/             ui kit (Sheet, Confirm, Toast, MoneyInput…), charts, forms, layout
   └─ pages/                  Dashboard, Transactions, Accounts, AccountDetail, Categories,
                              Trash, Activity, Sync, Settings, More, Auth, Onboarding
```

Layers are separated: UI (`components`, `pages`) → business logic (`ledger`, `calc`) → local DB (`db`) → sync (`sync`) → transport (`remote`).

## 2. Database schema

Cloud (`supabase/001_schema.sql`) and device (`src/db/db.js`) hold the same records.

| Table | Purpose | Key rules |
|---|---|---|
| `profiles` | display name, currency | created by trigger on sign-up |
| `accounts` | wallets/banks/cards | `initial_balance` BIGINT; type CHECK; `archived_at` |
| `categories` | income/expense categories, `parent_id` for subcategories | FK to parent with same `user_id` |
| `transactions` | **the ledger** | `amount > 0`; transfer must have a different `to_account_id`; income/expense require a category; adjustment requires `direction`; composite FKs `(account_id, user_id)` so rows can never reference another user's account |
| `audit_logs` | append-only change history | insert + select only |

Every synced table has `id uuid`, `user_id`, `created_at`, `updated_at`, `deleted_at`, `version` (bumped by trigger), `server_updated_at` (set by trigger, used as the pull cursor). Transactions also have `purged_at` (permanent-delete tombstone).

Accounting rules:

- Money is stored as integer minor units (₱100.50 → `10050`). No floats anywhere in calculations.
- Balances are never stored. `balance = initial_balance + Σ effects of live transactions` (`calc.js`).
- A transfer is **one row** with both accounts, so it can't be half-written; it moves money between accounts and is excluded from income and expense.
- Refunds increase the account and reduce spending in their category; they are not income.
- Adjustments (from Reconcile) are visible, audited rows and are reported separately from income/expense.
- Credit cards and loans are liabilities stored as negative balances. A card purchase is the expense; paying the card is a transfer, so nothing is counted twice. Net worth = assets − liabilities.
- Accounts with history are archived, never deleted. Transactions are soft-deleted to Trash; "Delete forever" wipes the details but keeps a tombstone so other devices learn about it.
- Transaction dates are stored as the user's local calendar date + time (`2026-09-27`, `12:30`), so a purchase never moves to another day because of timezone conversion.

## 3. API structure

There is no custom API server. The client talks to Supabase's auto-generated REST API (PostgREST), and **Row Level Security** is the authorization layer: every policy is `user_id = auth.uid()`. There are no DELETE policies on financial tables.

Sync calls used (`remote.js`):

| Call | Purpose |
|---|---|
| `insert(table, row)` | first upload of a new record |
| `update(row) WHERE id = ? AND version = ?` | edit only if nobody else changed it (optimistic lock) |
| `select * WHERE id = ?` | fetch the server copy after a conflict or lost response |
| `select * WHERE server_updated_at >= cursor ORDER BY server_updated_at LIMIT 500` | incremental pull |

## 4. Authentication architecture

Supabase Auth (email + password, bcrypt hashing server-side): sign up with email verification, sign in, sign out, forgot password, set new password from the email link, change password in Settings. Sessions persist and auto-refresh. If the device is offline and the session can't refresh, the app still opens the last signed-in user's local data (sync pauses until they sign in again). Signing out with unsynced changes warns first; the changes stay on the device.

If no Supabase env vars are set, Pera runs in **device-only mode**: no login, all features work locally, no cloud sync.

## 5. Offline architecture

- All reads come from IndexedDB through live queries, so screens render instantly and never wait for the network.
- Every write goes through `ledger.js` and is one IndexedDB transaction: save the record (`sync_status: pending`) + mark it in the `outbox` + append an audit entry. Either all of that happens or none of it.
- The service worker precaches the app shell, JS, CSS, fonts and icons, so the app opens and refreshes with no connection.
- `navigator.storage.persist()` is requested to protect local data from eviction.

## 6. Sync architecture

```
local write ─▶ outbox ─▶ push (accounts → categories → transactions → audit)
                           ├─ new record: INSERT (duplicate key → compare with server → adopt or conflict)
                           └─ edit: UPDATE … WHERE version = base  (0 rows → fetch → conflict)
             server ─▶ confirm (new version) ─▶ mark synced (unless edited again meanwhile)
pull since cursor (30 s overlap, idempotent) ─▶ apply, unless local copy has unsynced edits
```

- Triggers: app start, coming back online, tab becoming visible, 0.8 s after any local change, every 60 s, and the manual **Retry sync** button.
- Network failures retry with backoff (5 s doubling to 10 min). Server rejections are kept in the outbox and shown on the Sync screen. Local data is never deleted because a sync failed.
- No duplicates: record IDs are generated on the device, so a retried insert after a lost response hits a duplicate key and is reconciled, not re-created. Default categories use deterministic IDs so two devices don't each create "Food".
- Conflicts: if the same record changed on two devices, it's parked and shown under **Sync → Needs review** with a field-by-field diff and two choices: keep this device's version, or keep the other device's. Nothing is overwritten until the user chooses.

## 7. PWA configuration

`vite-plugin-pwa` (Workbox `generateSW`): manifest (name, short name, standalone, start URL, theme `#141B3C`, background `#F4F6FB`, icons 192/512/maskable), shortcuts (Add expense, Add income, Dashboard → `/?add=expense` etc.), precache with hashed file names, `cleanupOutdatedCaches` for old versions, SPA navigation fallback, no caching of Supabase API responses. Update detection shows an "A new version is ready — Update now" banner. Install: "Install Pera" button where `beforeinstallprompt` is supported, Share → Add to Home Screen instructions on iOS, and a fallback message elsewhere (Settings and More screens).

## 8. Installation

```bash
npm install
cp .env.example .env      # fill in Supabase values, or leave blank for device-only mode
npm run dev               # http://localhost:5173
npm test                  # 21 tests
npm run build && npm run preview   # production build with service worker on http://localhost:4173
npm run icons             # only if you change the logo
```

Requires Node 18+.

## 9. Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | for cloud mode | Supabase project URL (Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | for cloud mode | public anon key (safe in the browser; RLS protects data) |
| `VITE_APP_URL` | recommended | deployed URL, used for email confirmation and password-reset links |

Never put the `service_role` key in the frontend.

## 10. Database setup (Supabase)

1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/001_schema.sql`.
3. Authentication → URL Configuration: set **Site URL** to your deployed URL and add it (plus `http://localhost:5173`) to **Redirect URLs**.
4. Authentication → Providers → Email: keep "Confirm email" on for production.
5. Copy the project URL and anon key into `.env`.

## 11. Deployment (Vercel example)

1. Push the project to GitHub and import it in Vercel (framework: Vite).
2. Add the three env vars in Vercel → Settings → Environment Variables.
3. `vercel.json` (included) handles SPA routing:
   ```json
   { "rewrites": [{ "source": "/((?!assets|icons|sw.js|workbox-|manifest.webmanifest|favicon.svg|apple-touch-icon.png).*)", "destination": "/index.html" }] }
   ```
4. Deploy. HTTPS is automatic, which is required for install and the service worker.

Production backups (Sec 84): Supabase Pro includes daily backups with retention; enable Point-in-Time Recovery for finer restores. Restore procedure: Supabase dashboard → Database → Backups → Restore. Users can also download their own JSON backup in Settings.

## 12. Testing checklist

Automated (`npm test`, all passing):
- [x] Sec 87 scenario: Cash/GCash ₱5,000 → expense, income, transfer → ₱6,000 / ₱5,500 / total ₱11,500; transfer not counted as income or expense
- [x] Transfer is a single atomic record; invalid input (0 amount, missing/wrong account, same-account transfer, wrong-kind category, invalid date) writes nothing
- [x] Edit, soft delete and restore recompute balances; refunds; credit card no double count; reconciliation; archive-instead-of-delete; statement opening + movements = closing; money parsing without float drift
- [x] Sec 88: offline expense saved, shown, balance updated; syncs once when online; lost server response doesn't duplicate; edits from another device are pulled
- [x] Sec 73: conflicting edits detected; keep-mine and keep-server both work; nothing silently overwritten

Manually verified in headless Chromium: onboarding, Sec 87 through the real UI, smart category (Jollibee → Food), app reload while offline via service worker, all routes, reconcile/delete, dark mode desktop, mobile layout, no console errors.

Still to verify on real devices after you deploy: install on Android Chrome, iOS Safari (Add to Home Screen), desktop Chrome/Edge; two-device sync against your Supabase project; password reset email.

## 13. Known limitations

- Phases 2–4 features listed at the top are not built.
- Balances and dashboard totals are recomputed from the full local ledger on every change. Fine into the tens of thousands of transactions; a cached per-account running total is planned before 50k+.
- No realtime push from the server; other devices' changes arrive on the next sync (within 60 s, or immediately on focus).
- Transfers between accounts in different currencies are blocked (no exchange-rate handling yet). Totals assume one main currency.
- Data created in device-only mode is not migrated when you later switch to cloud mode.
- Purged transactions keep an empty tombstone row on the server (needed so other devices remove them too).
- Backup restore merges (adds/replaces); it never deletes records that aren't in the backup.
- Server-side rate limiting relies on Supabase Auth's built-in limits; there is no custom API to rate-limit.

## 14. Recommended next steps

1. **Phase 2:** budgets (monthly/weekly/category/overall, 50/80/100% alerts, rollover), bills with due statuses, recurring transactions with idempotent generation (deterministic IDs per occurrence so two devices can't create the same one twice), in-app + push notifications, Reports section with date ranges.
2. **Phase 3:** savings goals with contributions, debts with payment history, credit-card limits/statement dates, net-worth history, receipts (compressed images in Supabase Storage with per-user bucket policies), CSV import with column mapping + preview + duplicate detection, Excel/PDF export.
3. **Phase 4:** Supabase Realtime for instant cross-device updates, OCR with user confirmation, dashboard widget customization, category/account analytics screens.
4. Add Playwright end-to-end tests to CI and a scheduled Supabase backup check.
