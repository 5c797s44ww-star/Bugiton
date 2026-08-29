import { describe, expect, it } from 'vitest';
import { buildRecords, detectResolutionMinutes } from './buildRecords';
import { detectSeries } from './detectSeries';
import { loadTables } from './loadTables';
import { analyzeFiles } from './index';
import type { RawTable, SeriesCandidate, SeriesKind } from './types';

function hoursFrom(start: string, count: number, stepMinutes: number): string[] {
  const out: string[] = [];
  const startMs = new Date(start).getTime();
  for (let i = 0; i < count; i++) {
    out.push(new Date(startMs + i * stepMinutes * 60_000).toISOString());
  }
  return out;
}

describe('detectSeries — wide format (FI headers)', () => {
  it('finds all four kinds by column header text', () => {
    const timestamps = hoursFrom('2025-01-01T00:00:00Z', 5, 60);
    const table: RawTable = {
      fileName: 'test.csv',
      sheetName: 'Data',
      headers: [
        'Aikaleima',
        'Tuulivoiman tuotantoennuste (MW)',
        'Tuulivoiman kapasiteetti (MW)',
        'Aurinkovoiman tuotantoennuste (MW)',
        'Aurinkovoiman kapasiteetti (MW)',
      ],
      rows: timestamps.map((t, i) => [t, 100 + i, 1000, 20 + i, 500]),
    };
    const { candidatesByKind, warnings } = detectSeries([table]);
    expect(warnings).toEqual([]);
    expect(candidatesByKind.wind_forecast.length).toBeGreaterThanOrEqual(1);
    expect(candidatesByKind.solar_forecast.length).toBeGreaterThanOrEqual(1);
    expect(candidatesByKind.wind_capacity.length).toBeGreaterThanOrEqual(1);
    expect(candidatesByKind.solar_capacity.length).toBeGreaterThanOrEqual(1);
    expect(candidatesByKind.wind_forecast[0].unit).toBe('MW');
    expect(candidatesByKind.wind_forecast[0].values).toEqual([100, 101, 102, 103, 104]);
  });

  it('finds series by English headers too', () => {
    const timestamps = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const table: RawTable = {
      fileName: 'test.csv',
      sheetName: 'Sheet1',
      headers: ['Timestamp', 'Wind power production forecast', 'Wind available capacity', 'Solar production forecast', 'Solar available capacity'],
      rows: timestamps.map((t) => [t, 50, 900, 10, 400]),
    };
    const { candidatesByKind } = detectSeries([table]);
    expect(candidatesByKind.wind_forecast.length).toBe(1);
    expect(candidatesByKind.solar_forecast.length).toBe(1);
    expect(candidatesByKind.wind_capacity.length).toBe(1);
    expect(candidatesByKind.solar_capacity.length).toBe(1);
  });

  it('flags ambiguity when two columns match the same kind with similar confidence', () => {
    const timestamps = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const table: RawTable = {
      fileName: 'test.csv',
      sheetName: 'Data',
      headers: ['Aikaleima', 'Tuulivoiman tuotantoennuste', 'Tuulivoimatuotanto (toteuma)'],
      rows: timestamps.map((t) => [t, 100, 95]),
    };
    const { candidatesByKind } = detectSeries([table]);
    expect(candidatesByKind.wind_forecast.length).toBe(2);
  });
});

describe('detectSeries — timestamp jitter from Excel serial-date round-tripping', () => {
  it('rounds near-hour-boundary Date objects to the intended minute instead of dropping/merging hours', () => {
    // Simulates read-excel-file reconstructing Excel serial dates like 45658.08333333333
    // (02:00) with a few ms of floating-point error, e.g. landing on 01:59:59.997. Excel cells
    // are naive wall-clock values (no timezone), so a "2025-01-01 0:00, 1:00, ..." cell comes
    // back as a Date whose UTC-getters read those literal numbers - that's what's built here.
    const jitter = [0, 0, -3, 0, 2, 0, 0, -4]; // ms offsets applied to each hour
    const naiveBaseHour = Date.UTC(2025, 0, 1, 0, 0, 0);
    const timestamps = jitter.map((offset, h) => new Date(naiveBaseHour + h * 3600_000 + offset));
    const table: RawTable = {
      fileName: 'test.csv',
      sheetName: 'Tuulivoima',
      headers: ['Aikaleima', 'Tuulivoiman tuotantoennuste (MW)', 'Tuulivoiman kapasiteetti (MW)'],
      rows: timestamps.map((t, i) => [t, 100 + i, 1000]),
    };
    const { candidatesByKind } = detectSeries([table]);
    const forecast = candidatesByKind.wind_forecast[0];
    expect(forecast.timestamps.length).toBe(8);
    // Every timestamp must land exactly on its intended hour, not merged with a neighbor.
    const uniqueHours = new Set(forecast.timestamps);
    expect(uniqueHours.size).toBe(8);
    // Naive wall-clock times are interpreted as Finnish local time (winter here: UTC+2),
    // so the resulting UTC instants are 2 hours earlier than the naive "as-if-UTC" value.
    const expectedBaseUtc = naiveBaseHour - 2 * 3600_000;
    for (let h = 0; h < 8; h++) {
      expect(forecast.timestamps[h]).toBe(expectedBaseUtc + h * 3600_000);
    }
  });
});

describe('detectSeries — Fingrid long/stacked format', () => {
  it('groups rows by datasetId and classifies via known Fingrid dataset ids', () => {
    const timestamps = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const rows: unknown[][] = [];
    for (const t of timestamps) {
      rows.push([245, t, t, 100]); // wind forecast
      rows.push([268, t, t, 1000]); // wind capacity
      rows.push([248, t, t, 20]); // solar forecast
      rows.push([267, t, t, 500]); // solar capacity
      rows.push([999, t, t, 42]); // unrelated dataset (e.g. price) - should be ignored
    }
    const table: RawTable = {
      fileName: 'export.csv',
      sheetName: 'export',
      headers: ['datasetId', 'startTime', 'endTime', 'value'],
      rows,
    };
    const { candidatesByKind } = detectSeries([table]);
    expect(candidatesByKind.wind_forecast.length).toBe(1);
    expect(candidatesByKind.wind_forecast[0].confidence).toBeGreaterThan(0.9);
    expect(candidatesByKind.wind_forecast[0].values.length).toBe(3);
    expect(candidatesByKind.wind_capacity.length).toBe(1);
    expect(candidatesByKind.solar_forecast.length).toBe(1);
    expect(candidatesByKind.solar_capacity.length).toBe(1);
    // The unrelated dataset id 999 must not show up anywhere.
    for (const kind of Object.keys(candidatesByKind) as SeriesKind[]) {
      for (const c of candidatesByKind[kind]) {
        expect(c.datasetId).not.toBe(999);
      }
    }
  });
});

describe('detectResolutionMinutes', () => {
  it('detects 15-minute resolution', () => {
    const timestamps = hoursFrom('2025-01-01T00:00:00Z', 8, 15).map((s) => new Date(s).getTime());
    expect(detectResolutionMinutes(timestamps)).toBe(15);
  });

  it('detects hourly resolution', () => {
    const timestamps = hoursFrom('2025-01-01T00:00:00Z', 8, 60).map((s) => new Date(s).getTime());
    expect(detectResolutionMinutes(timestamps)).toBe(60);
  });
});

describe('buildRecords', () => {
  function series(kind: SeriesKind, timestamps: string[], values: number[], unit: 'MW' | 'MWh' = 'MW'): SeriesCandidate {
    return {
      id: kind,
      kind,
      fileName: 'test.csv',
      sheetName: 'test',
      label: kind,
      unit,
      confidence: 1,
      isActualGeneration: false,
      datasetId: null,
      timestamps: timestamps.map((t) => new Date(t).getTime()),
      values,
    };
  }

  // Required scenario: 15-min production + hourly capacity.
  it('computes CF per 15-min reading against its own hourly capacity, THEN aggregates (not the other way round)', () => {
    // Capacity DOUBLES mid-hour (12:00 -> 1000, 12:30 -> 2000). If production were aggregated
    // to hourly first and only then divided by a single hourly capacity, the result would be
    // avg(100,100,200,200)=150 / 1000 = 0.15. Computed correctly (CF per reading, then
    // averaged), it must be 0.1 for every reading, so the hourly average is 0.1.
    const ts = hoursFrom('2025-01-01T12:00:00Z', 4, 15); // 12:00, 12:15, 12:30, 12:45
    const windForecast = series('wind_forecast', ts, [100, 100, 200, 200]);
    const solarForecast = series('solar_forecast', ts, [0, 0, 0, 0]);
    const windCapacity = series('wind_capacity', ['2025-01-01T12:00:00Z', '2025-01-01T12:30:00Z'], [1000, 2000]);
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    expect(result.resolutionMinutes.wind_forecast).toBe(15);
    expect(result.resolutionMinutes.wind_capacity).toBe(30);
    expect(result.canonical.windCF.length).toBe(1);
    expect(result.canonical.windCF[0]).toBeCloseTo(0.1, 10);
  });

  // Required scenario: hourly production + hourly capacity (trivial, no resolution mismatch).
  it('handles matching hourly production and hourly capacity as a simple passthrough', () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const windForecast = series('wind_forecast', ts, [100, 200, 300]);
    const solarForecast = series('solar_forecast', ts, [10, 20, 30]);
    const windCapacity = series('wind_capacity', ts, [1000, 1000, 1000]);
    const solarCapacity = series('solar_capacity', ts, [500, 500, 500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    expect(result.resolutionMinutes).toEqual({
      wind_forecast: 60,
      solar_forecast: 60,
      wind_capacity: 60,
      solar_capacity: 60,
    });
    expect(Array.from(result.canonical.windCF)).toEqual([0.1, 0.2, 0.3]);
    expect(Array.from(result.canonical.solarCF)).toEqual([0.02, 0.04, 0.06]);
  });

  it('sums MWh energy values instead of averaging power', () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 4, 15);
    const windForecast = series('wind_forecast', ts, [10, 10, 10, 10], 'MWh');
    const solarForecast = series('solar_forecast', ts, [0, 0, 0, 0], 'MWh');
    const windCapacity = series('wind_capacity', ['2025-01-01T00:00:00Z'], [1000]);
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    // 10 MWh per 15-min interval = 40 MW average power; CF = 40/1000 = 0.04.
    expect(result.canonical.windCF[0]).toBeCloseTo(0.04, 10);
  });

  // Required scenario: capacity changing during the year.
  it('forward-fills time-varying capacity by timestamp (does not use one yearly constant)', () => {
    const ts = ['2025-01-15T00:00:00Z', '2025-06-15T00:00:00Z', '2025-12-15T00:00:00Z'];
    const windForecast = series('wind_forecast', ts, [100, 100, 100]);
    const solarForecast = series('solar_forecast', ts, [0, 0, 0]);
    const windCapacity = series(
      'wind_capacity',
      ['2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z', '2025-12-01T00:00:00Z'],
      [8000, 9000, 10000],
    );
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    expect(result.records[0].windCapacity).toBe(8000);
    expect(result.records[1].windCapacity).toBe(9000);
    expect(result.records[2].windCapacity).toBe(10000);
    expect(result.canonical.windCF[0]).toBeCloseTo(100 / 8000, 10);
    expect(result.canonical.windCF[1]).toBeCloseTo(100 / 9000, 10);
    expect(result.canonical.windCF[2]).toBeCloseTo(100 / 10000, 10);
  });

  // Required scenario: missing capacity values (series starts later than production).
  it('flags production readings before the first capacity data point instead of silently using zero', () => {
    const ts = ['2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'];
    const windForecast = series('wind_forecast', ts, [100, 100]);
    const solarForecast = series('solar_forecast', ts, [0, 0]);
    const windCapacity = series('wind_capacity', ['2025-01-02T00:00:00Z'], [1000]); // starts one day late
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    expect(result.records[0].windCapacity).toBe(1000); // backfilled from the first known value
    expect(result.issues.some((i) => i.type === 'capacity-extrapolated-start')).toBe(true);
  });

  // Required scenario: missing capacity values (gaps in the middle of the capacity series).
  it('flags gaps in the capacity series at its own native resolution', () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 6, 60);
    const windForecast = series('wind_forecast', ts, [100, 100, 100, 100, 100, 100]);
    const solarForecast = series('solar_forecast', ts, [0, 0, 0, 0, 0, 0]);
    // Capacity is hourly but hour 2 and 3 are missing entirely (a 3-hour gap between samples).
    const capTs = [ts[0], ts[1], ts[4], ts[5]];
    const windCapacity = series('wind_capacity', capTs, [1000, 1000, 1000, 1000]);
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    const missingIssue = result.issues.find((i) => i.type === 'native-missing-samples' && i.message.includes('Wind capacity'));
    expect(missingIssue).toBeDefined();
    expect(missingIssue?.count).toBe(2);
  });

  // Required scenario: duplicate timestamps.
  it('detects duplicate timestamps within a native series', () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const windForecast = series('wind_forecast', [...ts, ts[1]], [100, 100, 100, 999]); // ts[1] duplicated
    const solarForecast = series('solar_forecast', ts, [0, 0, 0]);
    const windCapacity = series('wind_capacity', ['2025-01-01T00:00:00Z'], [1000]);
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    const dupIssue = result.issues.find((i) => i.type === 'native-duplicate-timestamps' && i.message.includes('Wind production'));
    expect(dupIssue).toBeDefined();
    expect(dupIssue?.count).toBe(1);
  });

  // Required scenario: production exceeding capacity.
  it('flags production readings that exceed the capacity applicable at that timestamp, and clips CF to 1.0', () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const windForecast = series('wind_forecast', ts, [500, 1500, 500]); // middle reading exceeds capacity
    const solarForecast = series('solar_forecast', ts, [0, 0, 0]);
    const windCapacity = series('wind_capacity', ['2025-01-01T00:00:00Z'], [1000]);
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    const exceedIssue = result.issues.find((i) => i.type === 'native-production-exceeds-capacity');
    expect(exceedIssue).toBeDefined();
    expect(exceedIssue?.count).toBe(1);
    expect(result.canonical.windCF[1]).toBeLessThanOrEqual(1);
    expect(result.canonical.windCF[1]).toBeCloseTo(1, 10);
  });

});

describe('ingestion pipeline — DST transition (naive local timestamps)', () => {
  // Required scenario: daylight saving time. Naive (no-timezone) timestamps only get
  // Helsinki-local interpretation inside detectSeries' cell parsing, so this test goes through
  // the real CSV -> detectSeries -> buildRecords pipeline rather than hand-building candidates.
  it('handles the Helsinki DST spring-forward transition without losing or duplicating an hour', () => {
    // 2025-03-30: Finnish clocks jump from 03:00 EET straight to 04:00 EEST; 03:00-03:59 local
    // does not exist, so real data naturally has no reading for it. In UTC, 02:00 and 04:00
    // local end up only 1 hour apart, not 2.
    const naiveLocalTimes = ['2025-03-30 01:00', '2025-03-30 02:00', '2025-03-30 04:00', '2025-03-30 05:00'];
    const table: RawTable = {
      fileName: 'dst.csv',
      sheetName: 'dst.csv',
      headers: ['Aikaleima', 'Tuulivoiman tuotantoennuste (MW)', 'Tuulivoiman kapasiteetti (MW)', 'Aurinkovoiman tuotantoennuste (MW)', 'Aurinkovoiman kapasiteetti (MW)'],
      rows: naiveLocalTimes.map((t) => [t, 100, 1000, 0, 500]),
    };
    const { candidatesByKind } = detectSeries([table]);

    // The parser must have actually applied the Helsinki offset (not the sandbox's local tz).
    expect(new Date(candidatesByKind.wind_forecast[0].timestamps[0]).toISOString()).toBe('2025-03-29T23:00:00.000Z');
    expect(new Date(candidatesByKind.wind_forecast[0].timestamps[2]).toISOString()).toBe('2025-03-30T01:00:00.000Z');

    const result = buildRecords({
      wind_forecast: candidatesByKind.wind_forecast[0],
      solar_forecast: candidatesByKind.solar_forecast[0],
      wind_capacity: candidatesByKind.wind_capacity[0],
      solar_capacity: candidatesByKind.solar_capacity[0],
    });

    expect(result.canonical.timestamps.length).toBe(4);
    // No spurious "missing hour" should be reported for the skipped local 03:00 - the UTC
    // instants are genuinely contiguous.
    expect(result.issues.some((i) => i.type === 'missing-hours' || i.type === 'native-missing-samples')).toBe(false);
    const gapMs = result.canonical.timestamps[2].getTime() - result.canonical.timestamps[1].getTime();
    expect(gapMs).toBe(3600_000); // exactly 1 hour in UTC, confirming the DST jump was accounted for
  });
});

describe('loadTables', () => {
  it('parses a plain CSV file into a single RawTable', async () => {
    const csv = 'timestamp,wind_generation,solar_generation,wind_capacity,solar_capacity\n2025-01-01T00:00:00Z,10,0,100,50\n';
    const file = new File([csv], 'test.csv', { type: 'text/csv' });
    const tables = await loadTables(file);
    expect(tables.length).toBe(1);
    expect(tables[0].fileName).toBe('test.csv');
    expect(tables[0].headers).toEqual(['timestamp', 'wind_generation', 'solar_generation', 'wind_capacity', 'solar_capacity']);
    expect(tables[0].rows.length).toBe(1);
  });
});

describe('analyzeFiles — multiple files uploaded separately', () => {
  it('merges candidates from a production file and a separate capacity file', async () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const productionCsv = [
      'timestamp,Tuulivoiman tuotantoennuste (MW),Aurinkovoiman tuotantoennuste (MW)',
      ...ts.map((t, i) => `${t},${100 + i},${10 + i}`),
    ].join('\n');
    const capacityCsv = [
      'timestamp,Tuulivoiman kapasiteetti (MW),Aurinkovoiman kapasiteetti (MW)',
      ...ts.map((t) => `${t},1000,500`),
    ].join('\n');

    const productionFile = new File([productionCsv], 'production.csv', { type: 'text/csv' });
    const capacityFile = new File([capacityCsv], 'capacity.csv', { type: 'text/csv' });

    const analysis = await analyzeFiles([productionFile, capacityFile]);
    expect(analysis.missing).toEqual([]);
    expect(analysis.candidatesByKind.wind_forecast[0].fileName).toBe('production.csv');
    expect(analysis.candidatesByKind.wind_capacity[0].fileName).toBe('capacity.csv');
  });

  it('reports exactly which series are missing when capacity data was never uploaded', async () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 3, 60);
    const productionCsv = [
      'timestamp,Wind power production forecast,Solar power production forecast',
      ...ts.map((t, i) => `${t},${100 + i},${10 + i}`),
    ].join('\n');
    const file = new File([productionCsv], 'production_only.csv', { type: 'text/csv' });

    const analysis = await analyzeFiles([file]);
    expect(analysis.missing.sort()).toEqual(['solar_capacity', 'wind_capacity']);
  });
});
