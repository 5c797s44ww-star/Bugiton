import { KNOWN_FINGRID_DATASET_IDS } from './knownDatasets';
import {
  classifyText,
  detectUnit,
  looksLikeDatasetIdHeader,
  looksLikeDatasetNameHeader,
  looksLikeTimestampHeader,
  looksLikeValueHeader,
} from './keywords';
import type { RawTable, SeriesCandidate, SeriesKind } from './types';
import { SERIES_KINDS } from './types';

const MINUTE_MS = 60_000;

// Excel/date-library round-trips of fractional serial dates (e.g. 45658.08333333333 for
// 02:00) can reconstruct a timestamp a few milliseconds off the intended minute. Since none
// of the resolutions this tool deals with (15 min / hourly / daily) are ever sub-minute,
// rounding to the nearest minute here absorbs that jitter before it can shift an hour bucket.
function roundToMinute(ms: number): number {
  return Math.round(ms / MINUTE_MS) * MINUTE_MS;
}

function parseTimestampCell(v: unknown): number | null {
  if (v instanceof Date) return roundToMinute(v.getTime());
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return roundToMinute((v - 25569) * 86400 * 1000); // Excel serial date fallback
    return null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : roundToMinute(t);
  }
  return null;
}

function parseValueCell(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fractionParseable(rows: unknown[][], colIndex: number, parser: (v: unknown) => unknown): number {
  if (rows.length === 0) return 0;
  const sample = rows.slice(0, Math.min(rows.length, 200));
  let ok = 0;
  for (const row of sample) {
    if (parser(row[colIndex]) !== null) ok++;
  }
  return ok / sample.length;
}

function findTimestampColumn(table: RawTable): number {
  const { headers, rows } = table;
  const headerMatches = headers
    .map((h, i) => ({ i, h }))
    .filter(({ h }) => looksLikeTimestampHeader(h));

  if (headerMatches.length > 0) {
    // Prefer a "start"/"alku" style header over "end"/"loppu" when both exist.
    const start = headerMatches.find(({ h }) => /start|alku|^time$|^aika$|timestamp|date/i.test(h));
    return (start ?? headerMatches[0]).i;
  }

  // Fall back to whichever column parses mostly as dates.
  let best = -1;
  let bestFrac = 0;
  for (let i = 0; i < headers.length; i++) {
    const frac = fractionParseable(rows, i, parseTimestampCell);
    if (frac > bestFrac) {
      bestFrac = frac;
      best = i;
    }
  }
  return bestFrac >= 0.7 ? best : -1;
}

function extractSeries(rows: unknown[][], tsCol: number, valueCol: number): { timestamps: number[]; values: number[] } {
  const pairs: [number, number][] = [];
  for (const row of rows) {
    const t = parseTimestampCell(row[tsCol]);
    const v = parseValueCell(row[valueCol]);
    if (t !== null && v !== null) pairs.push([t, v]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return { timestamps: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]) };
}

let idCounter = 0;

function detectLongFormat(table: RawTable): { valueCol: number; datasetIdCol: number; nameCol: number } | null {
  const { headers } = table;
  const valueCol = headers.findIndex((h) => looksLikeValueHeader(h));
  if (valueCol === -1) return null;
  const datasetIdCol = headers.findIndex((h) => looksLikeDatasetIdHeader(h));
  const nameCol = headers.findIndex((h) => looksLikeDatasetNameHeader(h));
  if (datasetIdCol === -1 && nameCol === -1) return null;
  return { valueCol, datasetIdCol, nameCol };
}

function detectTablesLong(table: RawTable, tsCol: number, warnings: string[]): SeriesCandidate[] {
  const long = detectLongFormat(table);
  if (!long) return [];
  const { valueCol, datasetIdCol, nameCol } = long;

  const groups = new Map<string, { datasetId: number | null; name: string; rows: unknown[][] }>();
  for (const row of table.rows) {
    const rawId = datasetIdCol !== -1 ? row[datasetIdCol] : null;
    const datasetId = typeof rawId === 'number' ? rawId : typeof rawId === 'string' ? Number(rawId) : null;
    const name = nameCol !== -1 ? String(row[nameCol] ?? '') : '';
    const key = datasetId != null && Number.isFinite(datasetId) ? `id:${datasetId}` : `name:${name}`;
    if (!groups.has(key)) groups.set(key, { datasetId: Number.isFinite(datasetId as number) ? (datasetId as number) : null, name, rows: [] });
    groups.get(key)!.rows.push(row);
  }

  const candidates: SeriesCandidate[] = [];
  for (const { datasetId, name, rows } of groups.values()) {
    const known = datasetId != null ? KNOWN_FINGRID_DATASET_IDS[datasetId] : undefined;
    let kind: SeriesKind | null = null;
    let confidence = 0;
    let isActualGeneration = false;

    if (known) {
      kind = known.kind;
      isActualGeneration = known.isActualGeneration;
      confidence = 0.95;
    } else {
      const classified = classifyText(`${table.sheetName} ${name}`);
      if (classified) {
        kind = classified.kind;
        confidence = classified.confidence * 0.9; // slightly less sure without a known dataset id
        isActualGeneration = classified.isActualGeneration;
      }
    }
    if (!kind) continue;

    const unit = detectUnit(name) !== 'unknown' ? detectUnit(name) : detectUnit(table.sheetName);
    const { timestamps, values } = extractSeries(rows, tsCol, valueCol);
    if (timestamps.length === 0) {
      warnings.push(`Column group "${name || datasetId}" in "${table.sheetName}" had no parseable timestamp/value pairs.`);
      continue;
    }

    candidates.push({
      id: `long-${idCounter++}`,
      kind,
      sheetName: table.sheetName,
      label: name || (datasetId != null ? `dataset ${datasetId}` : 'unnamed series'),
      unit,
      confidence,
      isActualGeneration,
      datasetId: datasetId ?? null,
      timestamps,
      values,
    });
  }
  return candidates;
}

function detectTablesWide(table: RawTable, tsCol: number, warnings: string[]): SeriesCandidate[] {
  const candidates: SeriesCandidate[] = [];
  for (let col = 0; col < table.headers.length; col++) {
    if (col === tsCol) continue;
    const header = table.headers[col];
    const classified = classifyText(`${table.sheetName} ${header}`);
    if (!classified) continue;

    const { timestamps, values } = extractSeries(table.rows, tsCol, col);
    if (timestamps.length === 0) {
      warnings.push(`Column "${header}" in "${table.sheetName}" looked relevant but had no parseable numeric values.`);
      continue;
    }

    candidates.push({
      id: `wide-${idCounter++}`,
      kind: classified.kind,
      sheetName: table.sheetName,
      label: header,
      unit: detectUnit(header),
      confidence: classified.confidence,
      isActualGeneration: classified.isActualGeneration,
      datasetId: null,
      timestamps,
      values,
    });
  }
  return candidates;
}

export function detectSeries(tables: RawTable[]): { candidatesByKind: Record<SeriesKind, SeriesCandidate[]>; warnings: string[] } {
  const warnings: string[] = [];
  const all: SeriesCandidate[] = [];

  for (const table of tables) {
    const tsCol = findTimestampColumn(table);
    if (tsCol === -1) {
      warnings.push(`Could not find a timestamp column in sheet "${table.sheetName}"; its columns were skipped.`);
      continue;
    }
    const longCandidates = detectTablesLong(table, tsCol, warnings);
    if (longCandidates.length > 0) {
      all.push(...longCandidates);
    } else {
      all.push(...detectTablesWide(table, tsCol, warnings));
    }
  }

  const candidatesByKind = Object.fromEntries(SERIES_KINDS.map((k) => [k, [] as SeriesCandidate[]])) as Record<
    SeriesKind,
    SeriesCandidate[]
  >;
  for (const c of all) candidatesByKind[c.kind].push(c);
  for (const kind of SERIES_KINDS) candidatesByKind[kind].sort((a, b) => b.confidence - a.confidence);

  return { candidatesByKind, warnings };
}
