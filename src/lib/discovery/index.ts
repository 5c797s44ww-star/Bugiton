import { buildRecords } from './buildRecords';
import { detectSeries } from './detectSeries';
import { loadTablesFromFiles } from './loadTables';
import type { SeriesCandidate, SeriesKind } from './types';
import { SERIES_KINDS } from './types';

export type { BuiltDataset, CanonicalDataset, RawTable, ResolutionByKind, SeriesCandidate, SeriesKind } from './types';
export { SERIES_KINDS, SERIES_KIND_LABEL } from './types';
export { buildRecords } from './buildRecords';

export interface AnalyzeResult {
  fileNames: string[];
  candidatesByKind: Record<SeriesKind, SeriesCandidate[]>;
  warnings: string[];
  autoSelected: Partial<Record<SeriesKind, string>>;
  needsConfirmation: Record<SeriesKind, boolean>;
  missing: SeriesKind[];
}

const AUTO_SELECT_MIN_CONFIDENCE = 0.7;
const AUTO_SELECT_MIN_MARGIN = 0.15;

/**
 * Analyzes one or more uploaded files together (e.g. production and capacity data uploaded as
 * separate files, or several Excel worksheets) - all their tables are pooled into one detection
 * pass so candidates from different files can be matched against each other.
 */
export async function analyzeFiles(files: File[]): Promise<AnalyzeResult> {
  const tables = await loadTablesFromFiles(files);
  const { candidatesByKind, warnings } = detectSeries(tables);

  const autoSelected: Partial<Record<SeriesKind, string>> = {};
  const needsConfirmation = {} as Record<SeriesKind, boolean>;
  const missing: SeriesKind[] = [];

  for (const kind of SERIES_KINDS) {
    const candidates = candidatesByKind[kind];
    if (candidates.length === 0) {
      missing.push(kind);
      needsConfirmation[kind] = false;
      continue;
    }
    const top = candidates[0];
    const runnerUp = candidates[1];
    const clearWinner =
      candidates.length === 1 ||
      (top.confidence >= AUTO_SELECT_MIN_CONFIDENCE && top.confidence - (runnerUp?.confidence ?? 0) >= AUTO_SELECT_MIN_MARGIN);
    autoSelected[kind] = top.id;
    needsConfirmation[kind] = !clearWinner;
  }

  return { fileNames: files.map((f) => f.name), candidatesByKind, warnings, autoSelected, needsConfirmation, missing };
}

export function findCandidateById(
  candidatesByKind: Record<SeriesKind, SeriesCandidate[]>,
  kind: SeriesKind,
  id: string,
): SeriesCandidate | undefined {
  return candidatesByKind[kind].find((c) => c.id === id);
}

export function buildFromSelection(
  candidatesByKind: Record<SeriesKind, SeriesCandidate[]>,
  selection: Partial<Record<SeriesKind, string>>,
) {
  const resolved: Partial<Record<SeriesKind, SeriesCandidate>> = {};
  for (const kind of SERIES_KINDS) {
    const id = selection[kind];
    if (!id) return null;
    const candidate = findCandidateById(candidatesByKind, kind, id);
    if (!candidate) return null;
    resolved[kind] = candidate;
  }
  return buildRecords(resolved as Record<SeriesKind, SeriesCandidate>);
}
