import { describe, expect, it } from 'vitest';
import { hasExplicitOffset, helsinkiOffsetMinutesAt, helsinkiWallTimeToUtcMs, parseNaiveDateTimeComponents } from './timezone';

describe('hasExplicitOffset', () => {
  it('recognizes trailing Z and numeric offsets', () => {
    expect(hasExplicitOffset('2025-01-01T00:00:00Z')).toBe(true);
    expect(hasExplicitOffset('2025-01-01T00:00:00+02:00')).toBe(true);
    expect(hasExplicitOffset('2025-01-01T00:00:00-0500')).toBe(true);
  });

  it('rejects naive timestamps', () => {
    expect(hasExplicitOffset('2025-01-01T00:00:00')).toBe(false);
    expect(hasExplicitOffset('2025-01-01 00:00')).toBe(false);
    expect(hasExplicitOffset('1.1.2025 0:00')).toBe(false);
  });
});

describe('helsinkiOffsetMinutesAt', () => {
  it('is +120 min (UTC+2, EET) in winter', () => {
    expect(helsinkiOffsetMinutesAt(Date.UTC(2025, 0, 15, 12, 0, 0))).toBe(120);
  });

  it('is +180 min (UTC+3, EEST) in summer', () => {
    expect(helsinkiOffsetMinutesAt(Date.UTC(2025, 6, 15, 12, 0, 0))).toBe(180);
  });
});

describe('helsinkiWallTimeToUtcMs — DST transitions', () => {
  it('converts a winter local time correctly (UTC+2)', () => {
    // 2025-01-15 12:00 Helsinki time = 2025-01-15 10:00 UTC
    const utc = helsinkiWallTimeToUtcMs(2025, 0, 15, 12, 0, 0);
    expect(utc).toBe(Date.UTC(2025, 0, 15, 10, 0, 0));
  });

  it('converts a summer local time correctly (UTC+3)', () => {
    // 2025-07-15 12:00 Helsinki time = 2025-07-15 09:00 UTC
    const utc = helsinkiWallTimeToUtcMs(2025, 6, 15, 12, 0, 0);
    expect(utc).toBe(Date.UTC(2025, 6, 15, 9, 0, 0));
  });

  it('handles the spring-forward transition (clocks jump 03:00 -> 04:00 EEST)', () => {
    // 2025-03-30 is the last Sunday of March. Just before 03:00 local (EET, +2),
    // just after is 04:00+ local (EEST, +3).
    const before = helsinkiWallTimeToUtcMs(2025, 2, 30, 2, 30, 0); // 02:30 EET
    const after = helsinkiWallTimeToUtcMs(2025, 2, 30, 4, 30, 0); // 04:30 EEST
    expect(before).toBe(Date.UTC(2025, 2, 30, 0, 30, 0)); // 02:30 - 2h
    expect(after).toBe(Date.UTC(2025, 2, 30, 1, 30, 0)); // 04:30 - 3h
    // Exactly one hour of wall-clock time passed (03:xx doesn't exist), but two hours of UTC time did.
    expect(after - before).toBe(3600_000);
  });

  it('handles the fall-back transition (clocks repeat 03:00 -> 02:00 EET)', () => {
    // 2025-10-26 is the last Sunday of October.
    const beforeFallback = helsinkiWallTimeToUtcMs(2025, 9, 26, 2, 30, 0); // ambiguous/ EEST side by convention
    const afterFallback = helsinkiWallTimeToUtcMs(2025, 9, 26, 4, 30, 0); // unambiguous EET side
    // Whatever convention is chosen for the ambiguous hour, times outside it must be correct.
    expect(afterFallback).toBe(Date.UTC(2025, 9, 26, 2, 30, 0)); // 04:30 EET = 02:30 UTC
    expect(beforeFallback).toBeLessThan(afterFallback);
  });
});

describe('parseNaiveDateTimeComponents', () => {
  it('parses ISO-like naive strings', () => {
    expect(parseNaiveDateTimeComponents('2025-03-05T14:30:00')).toEqual({ y: 2025, mo: 2, d: 5, h: 14, mi: 30, sec: 0 });
    expect(parseNaiveDateTimeComponents('2025-03-05 14:30')).toEqual({ y: 2025, mo: 2, d: 5, h: 14, mi: 30, sec: 0 });
  });

  it('parses Finnish DD.MM.YYYY strings', () => {
    expect(parseNaiveDateTimeComponents('5.3.2025 14:30')).toEqual({ y: 2025, mo: 2, d: 5, h: 14, mi: 30, sec: 0 });
    expect(parseNaiveDateTimeComponents('05.03.2025')).toEqual({ y: 2025, mo: 2, d: 5, h: 0, mi: 0, sec: 0 });
  });

  it('returns null for unrecognized formats', () => {
    expect(parseNaiveDateTimeComponents('not a date')).toBeNull();
  });
});
