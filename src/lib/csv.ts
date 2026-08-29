import Papa from 'papaparse';
import type { HourlyRecord } from './types';

const COLUMN_ALIASES: Record<keyof Omit<HourlyRecord, 'timestamp'> | 'timestamp', string[]> = {
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'hour'],
  windGeneration: ['wind_generation', 'wind_gen', 'windgeneration', 'wind'],
  solarGeneration: ['solar_generation', 'solar_gen', 'solargeneration', 'solar'],
  windCapacity: ['wind_capacity', 'wind_cap', 'windcapacity', 'wind_installed_capacity'],
  solarCapacity: ['solar_capacity', 'solar_cap', 'solarcapacity', 'solar_installed_capacity'],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

export interface ParseResult {
  records: HourlyRecord[];
  errors: string[];
}

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const errors: string[] = parsed.errors.map((e) => `Row ${e.row ?? '?'}: ${e.message}`);
  const headers = parsed.meta.fields ?? [];

  const colTimestamp = findColumn(headers, COLUMN_ALIASES.timestamp);
  const colWindGen = findColumn(headers, COLUMN_ALIASES.windGeneration);
  const colSolarGen = findColumn(headers, COLUMN_ALIASES.solarGeneration);
  const colWindCap = findColumn(headers, COLUMN_ALIASES.windCapacity);
  const colSolarCap = findColumn(headers, COLUMN_ALIASES.solarCapacity);

  const missing: string[] = [];
  if (!colTimestamp) missing.push('timestamp');
  if (!colWindGen) missing.push('wind_generation');
  if (!colSolarGen) missing.push('solar_generation');
  if (!colWindCap) missing.push('wind_capacity');
  if (!colSolarCap) missing.push('solar_capacity');
  if (missing.length > 0) {
    return { records: [], errors: [`Missing required column(s): ${missing.join(', ')}`, ...errors] };
  }

  const records: HourlyRecord[] = [];
  let rowNum = 1;
  for (const row of parsed.data) {
    rowNum++;
    const tsRaw = row[colTimestamp as string];
    const ts = new Date(tsRaw);
    if (Number.isNaN(ts.getTime())) {
      errors.push(`Row ${rowNum}: could not parse timestamp "${tsRaw}".`);
      continue;
    }
    const windGeneration = Number(row[colWindGen as string]);
    const solarGeneration = Number(row[colSolarGen as string]);
    const windCapacity = Number(row[colWindCap as string]);
    const solarCapacity = Number(row[colSolarCap as string]);
    records.push({ timestamp: ts, windGeneration, solarGeneration, windCapacity, solarCapacity });
  }

  return { records, errors };
}
