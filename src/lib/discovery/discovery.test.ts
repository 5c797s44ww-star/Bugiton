import { describe, expect, it } from 'vitest';
import { buildRecords, detectResolutionMinutes } from './buildRecords';
import { detectSeries } from './detectSeries';
import { loadTables } from './loadTables';
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
    // (02:00) with a few ms of floating-point error, e.g. landing on 01:59:59.997.
    const jitter = [0, 0, -3, 0, 2, 0, 0, -4]; // ms offsets applied to each hour
    const baseHour = new Date('2025-01-01T00:00:00Z').getTime();
    const timestamps = jitter.map((offset, h) => new Date(baseHour + h * 3600_000 + offset));
    const table: RawTable = {
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
    for (let h = 0; h < 8; h++) {
      expect(forecast.timestamps[h]).toBe(baseHour + h * 3600_000);
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

  it('averages MW power values when aggregating 15-min data to hourly', () => {
    const ts = hoursFrom('2025-01-01T00:00:00Z', 8, 15); // 2 hours of 15-min data
    const windForecast = series('wind_forecast', ts, [100, 200, 300, 400, 100, 100, 100, 100]);
    const solarForecast = series('solar_forecast', ts, [0, 0, 0, 0, 0, 0, 0, 0]);
    const windCapacity = series('wind_capacity', ['2025-01-01T00:00:00Z'], [1000]);
    const solarCapacity = series('solar_capacity', ['2025-01-01T00:00:00Z'], [500]);

    const result = buildRecords({
      wind_forecast: windForecast,
      solar_forecast: solarForecast,
      wind_capacity: windCapacity,
      solar_capacity: solarCapacity,
    });

    expect(result.resolutionMinutes).toBe(15);
    expect(result.records.length).toBe(2);
    expect(result.records[0].windGeneration).toBeCloseTo(250); // avg(100,200,300,400)
    expect(result.records[1].windGeneration).toBeCloseTo(100); // avg(100,100,100,100)
  });

  it('sums MWh energy values instead of averaging', () => {
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

    expect(result.records[0].windGeneration).toBeCloseTo(40); // sum, not average
  });

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
  });

  it('flags hours before the first capacity data point instead of silently using zero', () => {
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
});

describe('loadTables', () => {
  it('parses a plain CSV file into a single RawTable', async () => {
    const csv = 'timestamp,wind_generation,solar_generation,wind_capacity,solar_capacity\n2025-01-01T00:00:00Z,10,0,100,50\n';
    const file = new File([csv], 'test.csv', { type: 'text/csv' });
    const tables = await loadTables(file);
    expect(tables.length).toBe(1);
    expect(tables[0].headers).toEqual(['timestamp', 'wind_generation', 'solar_generation', 'wind_capacity', 'solar_capacity']);
    expect(tables[0].rows.length).toBe(1);
  });
});
