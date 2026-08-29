export type SeriesKind = 'wind_forecast' | 'solar_forecast' | 'wind_capacity' | 'solar_capacity';

export const SERIES_KINDS: SeriesKind[] = ['wind_forecast', 'solar_forecast', 'wind_capacity', 'solar_capacity'];

export const SERIES_KIND_LABEL: Record<SeriesKind, string> = {
  wind_forecast: 'Wind production forecast',
  solar_forecast: 'Solar production forecast',
  wind_capacity: 'Wind capacity',
  solar_capacity: 'Solar capacity',
};

export type Unit = 'MW' | 'MWh' | 'unknown';

/** A plain table extracted from one CSV file or one Excel sheet. */
export interface RawTable {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: unknown[][];
}

/** A single detected timestamp+value series, tagged with a candidate kind and confidence. */
export interface SeriesCandidate {
  id: string;
  kind: SeriesKind;
  fileName: string;
  sheetName: string;
  label: string;
  unit: Unit;
  confidence: number;
  isActualGeneration: boolean;
  datasetId: number | null;
  timestamps: number[];
  values: number[];
}

export interface DiscoveryReport {
  candidatesByKind: Record<SeriesKind, SeriesCandidate[]>;
  selected: Partial<Record<SeriesKind, string>>;
  warnings: string[];
}

/** Independent resolution (minutes) detected for each of the four series - they need not match. */
export type ResolutionByKind = Record<SeriesKind, number | null>;

/** The canonical, source-agnostic format the optimization engine consumes. */
export interface CanonicalDataset {
  timestamps: Date[];
  windCF: Float64Array;
  solarCF: Float64Array;
}

export interface BuiltDataset {
  canonical: CanonicalDataset;
  records: import('../types').HourlyRecord[];
  resolutionMinutes: ResolutionByKind;
  periodStart: Date | null;
  periodEnd: Date | null;
  qualityPercent: number;
  issues: import('../types').DataQualityIssue[];
}
