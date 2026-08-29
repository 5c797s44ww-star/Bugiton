import type { DataQualityIssue, HourlyRecord } from './types';

const HOUR_MS = 60 * 60 * 1000;

export function checkDataQuality(records: HourlyRecord[]): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  if (records.length === 0) {
    return [{ type: 'empty', severity: 'error', message: 'No hourly records found.' }];
  }

  const sorted = [...records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Duplicate timestamps.
  const seen = new Map<number, number>();
  for (const r of sorted) {
    const t = r.timestamp.getTime();
    seen.set(t, (seen.get(t) ?? 0) + 1);
  }
  const dupCount = [...seen.values()].filter((c) => c > 1).length;
  if (dupCount > 0) {
    issues.push({
      type: 'duplicate-timestamps',
      severity: 'error',
      message: `${dupCount} duplicate timestamp(s) found.`,
      count: dupCount,
    });
  }

  // Missing hours (gaps in the sequence). Treat gaps of 23/25h specially (likely DST).
  let missingCount = 0;
  let dstLikeCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diffH = (sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime()) / HOUR_MS;
    if (diffH === 1) continue;
    if (diffH === 0) continue; // duplicate, already flagged
    if (Math.abs(diffH - 23) < 0.01 || Math.abs(diffH - 25) < 0.01) {
      dstLikeCount++;
    } else if (diffH > 1) {
      missingCount += Math.round(diffH - 1);
    }
  }
  if (missingCount > 0) {
    issues.push({
      type: 'missing-hours',
      severity: 'warning',
      message: `${missingCount} hour(s) appear to be missing from the time series.`,
      count: missingCount,
    });
  }
  if (dstLikeCount > 0) {
    issues.push({
      type: 'dst-transition',
      severity: 'info',
      message: `${dstLikeCount} timestamp gap(s) of 23h/25h detected, consistent with daylight-saving transitions. Verify the source data's timezone handling.`,
      count: dstLikeCount,
    });
  }

  // Missing / zero / inconsistent capacity values.
  let missingCapacity = 0;
  let zeroWindCapacity = 0;
  let zeroSolarCapacity = 0;
  let windOverCapacity = 0;
  let solarOverCapacity = 0;
  for (const r of sorted) {
    if (r.windCapacity == null || Number.isNaN(r.windCapacity) || r.solarCapacity == null || Number.isNaN(r.solarCapacity)) {
      missingCapacity++;
    }
    if (r.windCapacity === 0) zeroWindCapacity++;
    if (r.solarCapacity === 0) zeroSolarCapacity++;
    if (r.windCapacity > 0 && r.windGeneration > r.windCapacity * 1.001) windOverCapacity++;
    if (r.solarCapacity > 0 && r.solarGeneration > r.solarCapacity * 1.001) solarOverCapacity++;
  }
  if (missingCapacity > 0) {
    issues.push({
      type: 'missing-capacity',
      severity: 'error',
      message: `${missingCapacity} row(s) have missing capacity values.`,
      count: missingCapacity,
    });
  }
  if (zeroWindCapacity > 0) {
    issues.push({
      type: 'zero-wind-capacity',
      severity: 'warning',
      message: `${zeroWindCapacity} hour(s) have wind capacity = 0 (capacity factor treated as 0 for those hours).`,
      count: zeroWindCapacity,
    });
  }
  if (zeroSolarCapacity > 0) {
    issues.push({
      type: 'zero-solar-capacity',
      severity: 'warning',
      message: `${zeroSolarCapacity} hour(s) have solar capacity = 0 (capacity factor treated as 0 for those hours).`,
      count: zeroSolarCapacity,
    });
  }
  if (windOverCapacity > 0) {
    issues.push({
      type: 'wind-generation-over-capacity',
      severity: 'warning',
      message: `${windOverCapacity} hour(s) have wind generation exceeding installed capacity; capacity factor clipped to 1.0.`,
      count: windOverCapacity,
    });
  }
  if (solarOverCapacity > 0) {
    issues.push({
      type: 'solar-generation-over-capacity',
      severity: 'warning',
      message: `${solarOverCapacity} hour(s) have solar generation exceeding installed capacity; capacity factor clipped to 1.0.`,
      count: solarOverCapacity,
    });
  }

  // Timezone sanity check.
  const offsets = new Set(sorted.map((r) => r.timestamp.getTimezoneOffset()));
  if (offsets.size > 1) {
    issues.push({
      type: 'timezone-mixed-offsets',
      severity: 'info',
      message: 'Timestamps span more than one UTC offset (likely daylight-saving shifts in local time). Confirm the source timezone.',
    });
  }

  return issues;
}
