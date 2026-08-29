import type { DataQualityIssue } from '../types';

/**
 * Data-quality checks run at each series' *native* resolution, before any hourly
 * aggregation. Checking only the aggregated hourly output (as the legacy
 * `checkDataQuality` does) can smooth over problems - e.g. a single 15-minute spike
 * where production exceeds capacity gets averaged away into an unremarkable hourly
 * mean, or two duplicate 15-minute rows get silently merged into one hourly bucket.
 */

const MINUTE_MS = 60_000;

export function checkDuplicateTimestamps(timestamps: number[], label: string): DataQualityIssue | null {
  const seen = new Map<number, number>();
  for (const t of timestamps) seen.set(t, (seen.get(t) ?? 0) + 1);
  const dupCount = [...seen.values()].filter((c) => c > 1).length;
  if (dupCount === 0) return null;
  return {
    type: 'native-duplicate-timestamps',
    severity: 'error',
    message: `${label}: ${dupCount} duplicate timestamp(s) found in the source data.`,
    count: dupCount,
  };
}

export function checkNegativeValues(values: number[], label: string): DataQualityIssue | null {
  let count = 0;
  for (const v of values) if (v < 0) count++;
  if (count === 0) return null;
  return {
    type: 'native-negative-value',
    severity: 'error',
    message: `${label}: ${count} negative (impossible) value(s) found.`,
    count,
  };
}

export function checkZeroCapacity(values: number[], label: string): DataQualityIssue | null {
  let count = 0;
  for (const v of values) if (v === 0) count++;
  if (count === 0) return null;
  return {
    type: 'native-zero-capacity',
    severity: 'warning',
    message: `${label}: ${count} reading(s) of exactly 0 capacity (capacity factor treated as 0 for those timestamps).`,
    count,
  };
}

/** Detects gaps in a series' own native timestamp sequence, relative to its detected resolution. */
export function checkMissingNativeSamples(timestamps: number[], resolutionMinutes: number | null, label: string): DataQualityIssue | null {
  if (resolutionMinutes == null || timestamps.length < 2) return null;
  const sorted = [...new Set(timestamps)].sort((a, b) => a - b);
  const stepMs = resolutionMinutes * MINUTE_MS;
  let missing = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff > stepMs * 1.5) {
      missing += Math.round(diff / stepMs) - 1;
    }
  }
  if (missing === 0) return null;
  return {
    type: 'native-missing-samples',
    severity: 'warning',
    message: `${label}: ${missing} sample(s) appear to be missing at the source's own ${resolutionMinutes}-minute resolution.`,
    count: missing,
  };
}

/**
 * Cross-checks each production reading (already converted to average power in MW) against
 * the capacity applicable at that exact timestamp (forward-filled step function).
 */
export function checkProductionExceedsCapacity(
  productionTimestamps: number[],
  productionPowerMW: number[],
  capacityAt: (t: number) => number | null,
  label: string,
): DataQualityIssue | null {
  let count = 0;
  for (let i = 0; i < productionTimestamps.length; i++) {
    const cap = capacityAt(productionTimestamps[i]);
    if (cap != null && cap > 0 && productionPowerMW[i] > cap * 1.001) count++;
  }
  if (count === 0) return null;
  return {
    type: 'native-production-exceeds-capacity',
    severity: 'warning',
    message: `${label}: ${count} reading(s) exceed the installed capacity applicable at that timestamp; capacity factor clipped to 1.0 for those readings.`,
    count,
  };
}
