import type { SeriesKind, Unit } from './types';

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

const WIND_WORDS = ['tuulivoima', 'tuuli', 'wind'];
const SOLAR_WORDS = ['aurinkovoima', 'aurinko', 'solar', 'pv ', ' pv', 'photovoltaic', 'aurinkopaneeli'];

const FORECAST_WORDS = ['ennuste', 'forecast', 'prediction', 'ennustettu'];
const CAPACITY_WORDS = [
  'kapasiteetti',
  'capacity',
  'asennettu teho',
  'asennettu kapasiteetti',
  'kaytettavissa oleva',
  'installed',
  'available capacity',
  'nimellisteho',
  'kokonaiskapasiteetti',
  'nameplate',
];
const PRODUCTION_WORDS = ['tuotanto', 'production', 'generation', 'tuotantotieto', 'output'];

export function detectTech(text: string): 'wind' | 'solar' | null {
  const n = normalize(text);
  const hasWind = WIND_WORDS.some((w) => n.includes(normalize(w)));
  const hasSolar = SOLAR_WORDS.some((w) => n.includes(normalize(w)));
  if (hasWind && !hasSolar) return 'wind';
  if (hasSolar && !hasWind) return 'solar';
  return null;
}

export interface RoleScore {
  role: 'forecast' | 'capacity' | null;
  isActualGeneration: boolean;
  strength: number; // 0..1
}

export function detectRole(text: string): RoleScore {
  const n = normalize(text);
  const hasForecast = FORECAST_WORDS.some((w) => n.includes(normalize(w)));
  const hasCapacity = CAPACITY_WORDS.some((w) => n.includes(normalize(w)));
  const hasProduction = PRODUCTION_WORDS.some((w) => n.includes(normalize(w)));

  if (hasCapacity && !hasForecast) return { role: 'capacity', isActualGeneration: false, strength: 1 };
  if (hasForecast) return { role: 'forecast', isActualGeneration: false, strength: 1 };
  if (hasProduction) return { role: 'forecast', isActualGeneration: true, strength: 0.5 };
  return { role: null, isActualGeneration: false, strength: 0 };
}

export function detectUnit(text: string): Unit {
  const n = normalize(text);
  if (/\bmwh\b/.test(n)) return 'MWh';
  if (/\bmw\b/.test(n)) return 'MW';
  return 'unknown';
}

const TIMESTAMP_HEADER_WORDS = [
  'timestamp',
  'time',
  'datetime',
  'date',
  'starttime',
  'endtime',
  'aikaleima',
  'alkuaika',
  'loppuaika',
  'aika',
  'pvm',
  'paivamaara',
];

export function looksLikeTimestampHeader(header: string): boolean {
  const n = normalize(header);
  return TIMESTAMP_HEADER_WORDS.some((w) => n === normalize(w) || n.includes(normalize(w)));
}

const VALUE_HEADER_WORDS = ['value', 'arvo'];
export function looksLikeValueHeader(header: string): boolean {
  const n = normalize(header);
  return VALUE_HEADER_WORDS.some((w) => n === w);
}

const DATASET_ID_HEADER_WORDS = ['datasetid', 'dataset id', 'dataset', 'tietoaineisto', 'tietoaineistoid'];
export function looksLikeDatasetIdHeader(header: string): boolean {
  const n = normalize(header);
  return DATASET_ID_HEADER_WORDS.some((w) => n === normalize(w));
}

const DATASET_NAME_HEADER_WORDS = ['name', 'dataset name', 'nimi', 'sarja', 'series'];
export function looksLikeDatasetNameHeader(header: string): boolean {
  const n = normalize(header);
  return DATASET_NAME_HEADER_WORDS.some((w) => n === normalize(w));
}

export function classifyText(text: string): { kind: SeriesKind; confidence: number; isActualGeneration: boolean } | null {
  const tech = detectTech(text);
  if (!tech) return null;
  const { role, isActualGeneration, strength } = detectRole(text);
  if (!role) return null;
  const kind = `${tech}_${role}` as SeriesKind;
  const confidence = 0.5 + 0.35 * strength;
  return { kind, confidence, isActualGeneration };
}
