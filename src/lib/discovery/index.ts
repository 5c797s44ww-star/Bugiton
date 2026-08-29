import { buildRecords } from './buildRecords';
import { detectSeries } from './detectSeries';
import { loadTables } from './loadTables';
import type { SeriesCandidate, SeriesKind } from './types';
import { SERIES_KINDS } from './types';

export type { BuiltDataset, RawTable, SeriesCandidate, SeriesKind } from './types';
export { SERIES_KINDS, SERIES_KIND_LABEL } from './types';
export { buildRecords } from './buildRecords';

export interface AnalyzeResult {
  candidatesByKind: Record<SeriesKind, SeriesCandidate[]>;
  warnings: string[];
  autoSelected: Partial<Record<SeriesKind, string>>;
  needsConfirmation: Record<SeriesKind, boolean>;
  missing: SeriesKind[];
}

const AUTO_SELECT_MIN_CONFIDENCE = 0.7;
const AUTO_SELECT_MIN_MARGIN = 0.15;

export async function analyzeFile(file: File): Promise<AnalyzeResult> {
  const tables = await loadTables(file);
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

  return { candidatesByKind, warnings, autoSelected, needsConfirmation, missing };
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
