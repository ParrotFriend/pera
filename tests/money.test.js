import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney, toPlain } from '../src/lib/money.js';

describe('money', () => {
  it('parses to integer centavos without float error', () => {
    expect(parseMoney('100.50')).toBe(10050);
    expect(parseMoney('1,500')).toBe(150000);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('₱ 2,000.05')).toBe(200005);
    expect(parseMoney('19.99')).toBe(1999); // 19.99*100 = 1998.9999999999998 in float math
  });
  it('rejects bad input', () => {
    ['abc', '-5', '1.234', '1e5', '', '1.2.3'].forEach((s) => expect(parseMoney(s)).toBeNull());
  });
  it('sums repeatedly without drift', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) total += parseMoney('0.10');
    expect(total).toBe(10000);
    expect(toPlain(total)).toBe('100.00');
  });
  it('formats', () => {
    expect(formatMoney(4170000)).toBe('₱41,700.00');
    expect(formatMoney(-120000)).toBe('−₱1,200.00');
    expect(formatMoney(5, 'PHP', { sign: true })).toBe('+₱0.05');
  });
});
