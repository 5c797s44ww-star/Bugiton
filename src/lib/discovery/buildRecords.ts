import { checkDataQuality } from '../dataQuality';
import type { DataQualityIssue, HourlyRecord } from '../types';
import {
  checkDuplicateTimestamps,
  checkMissingNativeSamples,
  checkNegativeValues,
  checkProductionExceedsCapacity,
  checkZeroCapacity,
} from './nativeQuality';
import type { BuiltDataset, CanonicalDataset, ResolutionByKind, SeriesCandidate, SeriesKind, Unit } from './types';

const HOUR_MS = 3600_000;

export function detectResolutionMinutes(timestamps: number[]): number | null {
  if (timestamps.length < 2) return null;
  const sorted = [...new Set(timestamps)].sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) diffs.push(sorted[i] - sorted[i - 1]);
  diffs.sort((a, b) => a - b);
  const medianMs = diffs[Math.floor(diffs.length / 2)];
  const minutes = medianMs / 60000;

  const buckets = [15, 30, 60, 24 * 60];
  let best = buckets[0];
  let bestDiff = Infinity;
  for (const b of buckets) {
    const d = Math.abs(b - minutes);
    if (d < bestDiff) {
      bestDiff = d;
      best = b;
    }
  }
  return best;
}

/** Step-function lookup: latest value at or before the queried timestamp (forward-fill). */
function buildLookup(candidate: SeriesCandidate): (ms: number) => { value: number | null; extrapolated: boolean } {
  const pairs = candidate.timestamps.map((t, i) => ({ t, v: candidate.values[i] })).sort((a, b) => a.t - b.t);

  return (ms: number) => {
    if (pairs.length === 0) return { value: null, extrapolated: false };
    let lo = 0;
    let hi = pairs.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[mid].t <= ms) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans === -1) return { value: pairs[0].v, extrapolated: true };
    return { value: pairs[ans].v, extrapolated: false };
  };
}

function aggregateToHourlyByUnit(timestamps: number[], values: number[], unit: Unit): { timestamps: number[]; values: number[] } {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < timestamps.length; i++) {
    const hour = Math.floor(timestamps[i] / HOUR_MS) * HOUR_MS;
    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour)!.push(values[i]);
  }
  const hours = [...groups.keys()].sort((a, b) => a - b);
  const outTs: number[] = [];
  const outV: number[] = [];
  for (const h of hours) {
    const vals = groups.get(h)!;
    const sum = vals.reduce((s, v) => s + v, 0);
    outTs.push(h);
    outV.push(unit === 'MWh' ? sum : sum / vals.length);
  }
  return { timestamps: outTs, values: outV };
}

interface KindCFResult {
  hourlyTimestamps: number[];
  hourlyCF: number[];
  issues: DataQualityIssue[];
  productionResolutionMinutes: number | null;
  capacityResolutionMinutes: number | null;
}

/**
 * Builds the hourly capacity-factor series for one technology (wind or solar): production and
 * capacity may have entirely independent time resolutions (e.g. 15-min production vs hourly
 * capacity) and need not share timestamps at all. Each production reading is normalized by the
 * capacity applicable at its own exact timestamp (forward-filled step function) BEFORE any
 * aggregation - only then is the resulting per-reading CF averaged up to hourly. This is what
 * lets a capacity change mid-year (or even mid-hour) apply exactly where it should, rather than
 * one value being smeared across an entire hour or the whole year.
 */
function buildKindCF(productionCandidate: SeriesCandidate, capacityCandidate: SeriesCandidate, techLabel: string): KindCFResult {
  const issues: DataQualityIssue[] = [];

  const productionResolutionMinutes = detectResolutionMinutes(productionCandidate.timestamps);
  const capacityResolutionMinutes = detectResolutionMinutes(capacityCandidate.timestamps);

  const pushIfPresent = (issue: DataQualityIssue | null) => {
    if (issue) issues.push(issue);
  };
  pushIfPresent(checkDuplicateTimestamps(productionCandidate.timestamps, `${techLabel} production`));
  pushIfPresent(checkDuplicateTimestamps(capacityCandidate.timestamps, `${techLabel} capacity`));
  pushIfPresent(checkNegativeValues(productionCandidate.values, `${techLabel} production`));
  pushIfPresent(checkNegativeValues(capacityCandidate.values, `${techLabel} capacity`));
  pushIfPresent(checkZeroCapacity(capacityCandidate.values, `${techLabel} capacity`));
  pushIfPresent(checkMissingNativeSamples(productionCandidate.timestamps, productionResolutionMinutes, `${techLabel} production`));
  pushIfPresent(checkMissingNativeSamples(capacityCandidate.timestamps, capacityResolutionMinutes, `${techLabel} capacity`));

  // Convert each production reading to its average power (MW) over its own native interval.
  // An energy reading (MWh per interval) must be divided by the interval length in hours first;
  // a power reading (MW) needs no conversion. Getting this right matters because a capacity is
  // always a power quantity, so anything divided into it must be power too.
  const deltaHours = (productionResolutionMinutes ?? 60) / 60;
  const unit = productionCandidate.unit === 'unknown' ? 'MW' : productionCandidate.unit;
  const powerMW = productionCandidate.values.map((v) => (unit === 'MWh' ? v / deltaHours : v));

  const capacityAt = buildLookup(capacityCandidate);

  pushIfPresent(
    checkProductionExceedsCapacity(productionCandidate.timestamps, powerMW, (t) => capacityAt(t).value, `${techLabel} production`),
  );

  const n = productionCandidate.timestamps.length;
  const cfRaw = new Float64Array(n);
  let extrapolatedCount = 0;
  for (let i = 0; i < n; i++) {
    const cap = capacityAt(productionCandidate.timestamps[i]);
    if (cap.extrapolated) extrapolatedCount++;
    cfRaw[i] = cap.value != null && cap.value > 0 ? Math.min(1, powerMW[i] / cap.value) : 0;
  }
  if (extrapolatedCount > 0) {
    issues.push({
      type: 'capacity-extrapolated-start',
      severity: 'info',
      message: `${techLabel}: ${extrapolatedCount} production reading(s) occurred before the first available capacity data point; the earliest known capacity value was used for those readings.`,
      count: extrapolatedCount,
    });
  }

  // Aggregate the native-resolution CF to hourly by simple average - each native reading
  // represents an equal-length slice of the hour it falls in (e.g. four 15-min readings).
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const hour = Math.floor(productionCandidate.timestamps[i] / HOUR_MS) * HOUR_MS;
    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour)!.push(cfRaw[i]);
  }
  const hourlyTimestamps = [...groups.keys()].sort((a, b) => a - b);
  const hourlyCF = hourlyTimestamps.map((h) => {
    const vals = groups.get(h)!;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  });

  return { hourlyTimestamps, hourlyCF, issues, productionResolutionMinutes, capacityResolutionMinutes };
}

/**
 * Builds a parallel hourly generation+capacity view purely so the existing hourly-grain
 * `checkDataQuality` (duplicate/missing hours, zero/over-capacity, timezone hints) and the
 * hour-count shown to the user can be reused unmodified; the canonical CF series above is what
 * actually feeds the optimizer.
 */
function buildHourlyRecordsForDisplay(selection: Record<SeriesKind, SeriesCandidate>, hours: number[]): HourlyRecord[] {
  const windForecast = selection.wind_forecast;
  const solarForecast = selection.solar_forecast;

  const windHourlyGen = aggregateToHourlyByUnit(
    windForecast.timestamps,
    windForecast.values,
    windForecast.unit === 'unknown' ? 'MW' : windForecast.unit,
  );
  const solarHourlyGen = aggregateToHourlyByUnit(
    solarForecast.timestamps,
    solarForecast.values,
    solarForecast.unit === 'unknown' ? 'MW' : solarForecast.unit,
  );
  const windGenMap = new Map(windHourlyGen.timestamps.map((t, i) => [t, windHourlyGen.values[i]]));
  const solarGenMap = new Map(solarHourlyGen.timestamps.map((t, i) => [t, solarHourlyGen.values[i]]));
  const windCapAt = buildLookup(selection.wind_capacity);
  const solarCapAt = buildLookup(selection.solar_capacity);

  return hours.map((h) => ({
    timestamp: new Date(h),
    windGeneration: windGenMap.get(h) ?? 0,
    solarGeneration: solarGenMap.get(h) ?? 0,
    windCapacity: windCapAt(h).value ?? 0,
    solarCapacity: solarCapAt(h).value ?? 0,
  }));
}

function computeQualityPercent(recordCount: number, expectedHours: number, issues: DataQualityIssue[]): number {
  if (expectedHours <= 0) return 0;
  const completeness = Math.min(1, recordCount / expectedHours);
  const errorCount = issues.filter((i) => i.severity === 'error').reduce((s, i) => s + (i.count ?? 1), 0);
  const warningCount = issues.filter((i) => i.severity === 'warning').reduce((s, i) => s + (i.count ?? 1), 0);
  const penalty = Math.min(1, (errorCount + warningCount * 0.3) / expectedHours);
  return Math.max(0, Math.round((completeness - penalty) * 1000) / 10);
}

export function buildRecords(selection: Record<SeriesKind, SeriesCandidate>): BuiltDataset {
  const wind = buildKindCF(selection.wind_forecast, selection.wind_capacity, 'Wind');
  const solar = buildKindCF(selection.solar_forecast, selection.solar_capacity, 'Solar');

  const hourSet = new Set<number>([...wind.hourlyTimestamps, ...solar.hourlyTimestamps]);
  const hours = [...hourSet].sort((a, b) => a - b);

  const windMap = new Map(wind.hourlyTimestamps.map((t, i) => [t, wind.hourlyCF[i]]));
  const solarMap = new Map(solar.hourlyTimestamps.map((t, i) => [t, solar.hourlyCF[i]]));

  const timestamps: Date[] = [];
  const windCF: number[] = [];
  const solarCF: number[] = [];
  for (const h of hours) {
    const wcf = windMap.get(h);
    const scf = solarMap.get(h);
    if (wcf === undefined && scf === undefined) continue; // genuine gap in both series
    timestamps.push(new Date(h));
    windCF.push(wcf ?? 0);
    solarCF.push(scf ?? 0);
  }

  const canonical: CanonicalDataset = {
    timestamps,
    windCF: Float64Array.from(windCF),
    solarCF: Float64Array.from(solarCF),
  };

  const includedHours = timestamps.map((d) => d.getTime());
  const records = buildHourlyRecordsForDisplay(selection, includedHours);
  const hourlyIssues = checkDataQuality(records);
  const issues = [...wind.issues, ...solar.issues, ...hourlyIssues];

  const periodStart = includedHours.length > 0 ? new Date(includedHours[0]) : null;
  const periodEnd = includedHours.length > 0 ? new Date(includedHours[includedHours.length - 1]) : null;
  const expectedHours =
    periodStart && periodEnd ? Math.round((periodEnd.getTime() - periodStart.getTime()) / HOUR_MS) + 1 : 0;
  const qualityPercent = computeQualityPercent(records.length, expectedHours, issues);

  const resolutionMinutes: ResolutionByKind = {
    wind_forecast: wind.productionResolutionMinutes,
    solar_forecast: solar.productionResolutionMinutes,
    wind_capacity: wind.capacityResolutionMinutes,
    solar_capacity: solar.capacityResolutionMinutes,
  };

  return { canonical, records, resolutionMinutes, periodStart, periodEnd, qualityPercent, issues };
}
