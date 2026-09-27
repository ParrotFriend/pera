import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db.js';
import * as L from '../src/services/ledger.js';
import { createSyncEngine } from '../src/services/sync.js';
import { computeBalances } from '../src/services/calc.js';
import { createFakeRemote } from './fakeRemote.js';
import { toLocalDate } from '../src/lib/dates.js';

const P = (x) => x * 100;
const today = toLocalDate();
let remote, engine, gcash, cash, food;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  L.setActor({ userId: 'u1', device: 'phone', currency: 'PHP' });
  remote = createFakeRemote();
  engine = createSyncEngine({ remote, getUserId: () => 'u1', isOnline: () => remote.online });
  await L.ensureDefaultCategories('u1');
  gcash = await L.saveAccount({ name: 'GCash', type: 'ewallet', initial_balance: P(5000) });
  cash = await L.saveAccount({ name: 'Cash', type: 'cash', initial_balance: P(5000) });
  food = await db.categories.filter((c) => c.name === 'Food' && c.kind === 'expense').first();
  await engine.sync();
});

describe('Section 88 — offline then online', () => {
  it('keeps an offline expense locally, then syncs it exactly once', async () => {
    remote.online = false;
    const t = await L.saveTransaction({ type: 'expense', amount: P(500), account_id: gcash.id, category_id: food.id, date: today });
    await engine.sync();
    expect(engine.getState().status).toBe('offline');
    let local = await db.transactions.get(t.id);
    expect(local.sync_status).toBe('pending');
    const bal = computeBalances(await db.accounts.toArray(), await db.transactions.toArray());
    expect(bal.get(gcash.id)).toBe(P(4500)); // balance updated while offline

    remote.online = true;
    await engine.retryNow();
    local = await db.transactions.get(t.id);
    expect(local.sync_status).toBe('synced');
    expect(remote.tables.transactions.size).toBe(1);
    expect(engine.getState().pending).toBe(0);
  });

  it('does not duplicate when the server saved it but the response was lost', async () => {
    remote.dropNextResponse = true;
    const t = await L.saveTransaction({ type: 'transfer', amount: P(1000), account_id: cash.id, to_account_id: gcash.id, date: today });
    await engine.sync();
    expect((await db.transactions.get(t.id)).sync_status).toBe('pending');
    await engine.retryNow();
    expect((await db.transactions.get(t.id)).sync_status).toBe('synced');
    expect([...remote.tables.transactions.values()].filter((x) => x.id === t.id)).toHaveLength(1);
  });

  it('pulls changes made on another device', async () => {
    const t = await L.saveTransaction({ type: 'expense', amount: P(100), account_id: gcash.id, category_id: food.id, date: today });
    await engine.sync();
    remote.remoteEdit('transactions', t.id, { amount: P(150), notes: 'edited on laptop' });
    await engine.sync();
    const local = await db.transactions.get(t.id);
    expect(local.amount).toBe(P(150));
    expect(local.version).toBe(2);
  });
});

describe('Section 73 — conflicts are never silently overwritten', () => {
  async function makeConflict() {
    const t = await L.saveTransaction({ type: 'expense', amount: P(100), account_id: gcash.id, category_id: food.id, date: today });
    await engine.sync();
    remote.remoteEdit('transactions', t.id, { amount: P(300) }); // laptop
    await L.saveTransaction({ type: 'expense', amount: P(200), account_id: gcash.id, category_id: food.id, date: today }, t.id); // phone
    await engine.sync();
    return t.id;
  }

  it('detects the conflict and keeps both versions', async () => {
    const id = await makeConflict();
    expect((await db.transactions.get(id)).sync_status).toBe('conflict');
    expect((await db.transactions.get(id)).amount).toBe(P(200));
    expect(remote.tables.transactions.get(id).amount).toBe(P(300));
    expect(engine.getState().conflicts).toBe(1);
  });

  it('keep this device → server gets our version', async () => {
    const id = await makeConflict();
    await engine.resolveConflict(`transactions:${id}`, 'local');
    await engine.sync();
    expect(remote.tables.transactions.get(id).amount).toBe(P(200));
    expect((await db.transactions.get(id)).sync_status).toBe('synced');
  });

  it('keep server version → local takes server copy', async () => {
    const id = await makeConflict();
    await engine.resolveConflict(`transactions:${id}`, 'server');
    expect((await db.transactions.get(id)).amount).toBe(P(300));
    expect((await db.transactions.get(id)).sync_status).toBe('synced');
    expect(await db.outbox.where('key').equals(`transactions:${id}`).count()).toBe(0);
  });
});
