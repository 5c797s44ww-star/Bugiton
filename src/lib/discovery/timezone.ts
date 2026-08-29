/**
 * Fingrid's own API/exports carry explicit-offset ISO 8601 timestamps (e.g. trailing `Z`),
 * which are unambiguous and must be trusted as-is. But a user's own CSV export or an Excel
 * workbook stores timestamps as *naive* wall-clock values with no timezone attached (Excel
 * has no timezone concept at all - a serial date is just a naive date+time). For Fingrid data
 * that naive wall-clock time is Finnish local time, so it must be converted to the correct
 * UTC instant, including across DST transitions - otherwise every naive timestamp silently
 * ends up 2-3 hours off.
 *
 * This uses `Intl.DateTimeFormat` (ships full IANA tz data in browsers and Node) rather than
 * a timezone-database dependency.
 */

const HELSINKI_TZ = 'Europe/Helsinki';

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HELSINKI_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Returns the Europe/Helsinki UTC offset (in minutes, e.g. 120 or 180) in effect at a given UTC instant. */
export function helsinkiOffsetMinutesAt(utcMs: number): number {
  const parts = offsetFormatter.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return Math.round((asIfUtc - utcMs) / 60_000);
}

/**
 * Converts naive wall-clock date/time components (as if they were Helsinki local time) to
 * the correct UTC instant, handling DST by iterating to a fixed point (the offset only takes
 * two values across the year, so this always converges in at most 2 steps).
 */
export function helsinkiWallTimeToUtcMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const naiveAsUtc = Date.UTC(y, mo, d, h, mi, s);
  let guess = naiveAsUtc;
  for (let i = 0; i < 3; i++) {
    const offset = helsinkiOffsetMinutesAt(guess);
    const next = naiveAsUtc - offset * 60_000;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** True if a timestamp string already carries an explicit UTC/offset marker (trailing Z or ±HH:MM). */
export function hasExplicitOffset(s: string): boolean {
  return /Z$|[+-]\d{2}:?\d{2}$/.test(s.trim());
}

const ISO_NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const FI_NAIVE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[T ]?(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/** Parses a naive (no-timezone) date/time string into components, or null if unrecognized. */
export function parseNaiveDateTimeComponents(
  s: string,
): { y: number; mo: number; d: number; h: number; mi: number; sec: number } | null {
  let m = ISO_NAIVE.exec(s);
  if (m) {
    return {
      y: Number(m[1]),
      mo: Number(m[2]) - 1,
      d: Number(m[3]),
      h: Number(m[4]),
      mi: Number(m[5]),
      sec: m[6] ? Number(m[6]) : 0,
    };
  }
  m = FI_NAIVE.exec(s);
  if (m) {
    return {
      y: Number(m[3]),
      mo: Number(m[2]) - 1,
      d: Number(m[1]),
      h: m[4] ? Number(m[4]) : 0,
      mi: m[5] ? Number(m[5]) : 0,
      sec: m[6] ? Number(m[6]) : 0,
    };
  }
  return null;
}

/**
 * Interprets a naive Date object (as produced by an Excel-cell reader, which has no timezone
 * concept) as Finnish local wall-clock time and returns the correct UTC instant in ms.
 */
export function naiveDateToHelsinkiUtcMs(d: Date): number {
  return helsinkiWallTimeToUtcMs(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}
