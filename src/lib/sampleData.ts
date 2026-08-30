import type { HourlyRecord } from './types';

// Small seeded PRNG (mulberry32) so the demo dataset is reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a synthetic full-year hourly dataset (demo/preview data) with
 * plausible diurnal + seasonal patterns for wind and solar capacity factors.
 * Not real measured data - intended only so the calculator works out of the box
 * before a user uploads their own hourly generation data.
 */
export function generateSampleData(year = 2024): HourlyRecord[] {
  const rng = mulberry32(42);
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const hoursInYear = isLeap ? 8784 : 8760;

  const windCapacityMW = 1000;
  const solarCapacityMW = 800;

  const records: HourlyRecord[] = [];
  let windState = 0.4; // AR(1) latent state driving wind CF
  const start = Date.UTC(year, 0, 1, 0, 0, 0);

  for (let h = 0; h < hoursInYear; h++) {
    const timestamp = new Date(start + h * 3600 * 1000);
    const dayOfYear = h / 24;
    const hourOfDay = h % 24;

    // Wind: seasonal mean (higher in winter) + autocorrelated noise.
    const seasonalWind = 0.45 + 0.15 * Math.cos((2 * Math.PI * (dayOfYear - 15)) / 365);
    const shock = (rng() - 0.5) * 0.25;
    windState = windState * 0.85 + (seasonalWind + shock) * 0.15;
    const windCF = Math.min(1, Math.max(0, windState + (rng() - 0.5) * 0.1));

    // Solar: diurnal bell curve modulated by season. `season` is +1 at the summer solstice
    // (~21 June, day-of-year 171) and -1 at the winter solstice (~21 December, day-of-year
    // 354), so both day length and peak intensity swing between those two dates correctly -
    // darkest/lowest around 21 Dec, brightest/highest around 21 Jun, as at Finnish latitudes.
    const SUMMER_SOLSTICE_DAY = 171;
    const season = Math.cos((2 * Math.PI * (dayOfYear - SUMMER_SOLSTICE_DAY)) / 365.25);
    const dayLengthHours = 12 + 6 * season; // ~18h at midsummer, ~6h at midwinter
    const hourFromNoon = hourOfDay - 12;
    const halfDay = dayLengthHours / 2;
    const solarShape = Math.abs(hourFromNoon) < halfDay ? Math.cos((hourFromNoon / halfDay) * (Math.PI / 2)) : 0;
    const seasonalPeakIntensity = 0.5 + 0.4 * season; // ~0.9 at midsummer, ~0.1 at midwinter (low sun angle)
    const cloudNoise = 1 - rng() * 0.35;
    const solarCF = Math.min(1, Math.max(0, solarShape * seasonalPeakIntensity * cloudNoise));

    records.push({
      timestamp,
      windGeneration: windCF * windCapacityMW,
      solarGeneration: solarCF * solarCapacityMW,
      windCapacity: windCapacityMW,
      solarCapacity: solarCapacityMW,
    });
  }

  return records;
}
