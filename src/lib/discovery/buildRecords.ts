import { checkDataQuality } from '../dataQuality';
import type { DataQualityIssue, HourlyRecord } from '../types';
import type { BuiltDataset, SeriesCandidate, SeriesKind, Unit } from './types';

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

function aggregateToHourly(
  timestamps: number[],
  values: number[],
  unit: Unit,
): { timestamps: number[]; values: number[] } {
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

/** Step-function lookup: latest capacity value at or before the queried hour (forward-fill). */
function buildCapacityLookup(candidate: SeriesCandidate): (hourMs: number) => { value: number | null; extrapolated: boolean } {
  const pairs = candidate.timestamps
    .map((t, i) => ({ t, v: candidate.values[i] }))
    .sort((a, b) => a.t - b.t);

  return (hourMs: number) => {
    if (pairs.length === 0) return { value: null, extrapolated: false };
    let lo = 0;
    let hi = pairs.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[mid].t <= hourMs) {
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

function computeQualityPercent(recordCount: number, expectedHours: number, issues: DataQualityIssue[]): number {
  if (expectedHours <= 0) return 0;
  const completeness = Math.min(1, recordCount / expectedHours);
  const errorCount = issues.filter((i) => i.severity === 'error').reduce((s, i) => s + (i.count ?? 1), 0);
  const warningCount = issues.filter((i) => i.severity === 'warning').reduce((s, i) => s + (i.count ?? 1), 0);
  const penalty = Math.min(1, (errorCount + warningCount * 0.3) / expectedHours);
  return Math.max(0, Math.round((completeness - penalty) * 1000) / 10);
}

export function buildRecords(selection: Record<SeriesKind, SeriesCandidate>): BuiltDataset {
  const windForecast = selection.wind_forecast;
  const solarForecast = selection.solar_forecast;

  const resWind = detectResolutionMinutes(windForecast.timestamps);
  const resSolar = detectResolutionMinutes(solarForecast.timestamps);
  const resolutionMinutes = resWind != null && resSolar != null ? Math.min(resWind, resSolar) : (resWind ?? resSolar);

  const windHourly = aggregateToHourly(
    windForecast.timestamps,
    windForecast.values,
    windForecast.unit === 'unknown' ? 'MW' : windForecast.unit,
  );
  const solarHourly = aggregateToHourly(
    solarForecast.timestamps,
    solarForecast.values,
    solarForecast.unit === 'unknown' ? 'MW' : solarForecast.unit,
  );

  const windCapAt = buildCapacityLookup(selection.wind_capacity);
  const solarCapAt = buildCapacityLookup(selection.solar_capacity);

  const hourSet = new Set<number>([...windHourly.timestamps, ...solarHourly.timestamps]);
  const hours = [...hourSet].sort((a, b) => a - b);

  const windMap = new Map(windHourly.timestamps.map((t, i) => [t, windHourly.values[i]]));
  const solarMap = new Map(solarHourly.timestamps.map((t, i) => [t, solarHourly.values[i]]));

  const records: HourlyRecord[] = [];
  let extrapolatedCount = 0;
  for (const h of hours) {
    const windGen = windMap.get(h);
    const solarGen = solarMap.get(h);
    if (windGen === undefined && solarGen === undefined) continue;
    const windCap = windCapAt(h);
    const solarCap = solarCapAt(h);
    if (windCap.extrapolated || solarCap.extrapolated) extrapolatedCount++;
    records.push({
      timestamp: new Date(h),
      windGeneration: windGen ?? 0,
      solarGeneration: solarGen ?? 0,
      windCapacity: windCap.value ?? 0,
      solarCapacity: solarCap.value ?? 0,
    });
  }

  const issues = checkDataQuality(records);
  if (extrapolatedCount > 0) {
    issues.push({
      type: 'capacity-extrapolated-start',
      severity: 'info',
      message: `${extrapolatedCount} hour(s) occurred before the first available capacity data point; the earliest known capacity value was used for those hours.`,
      count: extrapolatedCount,
    });
  }

  const periodStart = hours.length > 0 ? new Date(hours[0]) : null;
  const periodEnd = hours.length > 0 ? new Date(hours[hours.length - 1]) : null;
  const expectedHours =
    periodStart && periodEnd ? Math.round((periodEnd.getTime() - periodStart.getTime()) / HOUR_MS) + 1 : 0;

  const qualityPercent = computeQualityPercent(records.length, expectedHours, issues);

  return { records, resolutionMinutes, periodStart, periodEnd, qualityPercent, issues };
}
