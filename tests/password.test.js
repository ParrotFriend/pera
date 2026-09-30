import { describe, it, expect } from 'vitest';
import { passwordProblems } from '../src/components/PasswordField.jsx';

describe('password rules', () => {
  it('lists what is missing', () => {
    expect(passwordProblems('abc')).toHaveLength(4);
    expect(passwordProblems('abcdefgh')).toEqual(['A capital letter (A–Z)', 'A number (0–9)', 'A special character (e.g. ! @ # $ % & *)']);
  });
  it('accepts a strong password', () => {
    expect(passwordProblems('Pera#2026ok')).toEqual([]);
    expect(passwordProblems('Ñiño-Peso9')).toEqual([]);
  });
  it('rejects spaces at the ends and over-long passwords', () => {
    expect(passwordProblems(' Pera#2026ok')).toContain('No spaces at the start or end');
    expect(passwordProblems('Aa1!' + 'x'.repeat(80))).toContain('At most 72 characters');
  });
});