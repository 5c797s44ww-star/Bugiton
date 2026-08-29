import type { SeriesKind } from './types';

/**
 * Fingrid open data (data.fingrid.fi) dataset IDs for the series this tool needs.
 * When a file carries a numeric datasetId column (Fingrid's native multi-dataset
 * export format), matching against this table is far more reliable than text
 * matching alone.
 */
export const KNOWN_FINGRID_DATASET_IDS: Record<number, { kind: SeriesKind; isActualGeneration: boolean }> = {
  245: { kind: 'wind_forecast', isActualGeneration: false }, // Tuulivoiman tuotantoennuste - 15 min
  246: { kind: 'wind_forecast', isActualGeneration: false }, // Tuulivoiman tuotantoennuste - vuorokausi
  268: { kind: 'wind_capacity', isActualGeneration: false }, // Tuulivoimaennusteessa kaytetty kokonaiskapasiteetti
  181: { kind: 'wind_forecast', isActualGeneration: true }, // Tuulivoimatuotanto - reaaliaikatieto (actual)
  75: { kind: 'wind_forecast', isActualGeneration: true }, // Wind power generation - 15 min data (actual)
  247: { kind: 'solar_forecast', isActualGeneration: false }, // Aurinkovoiman tuotantoennuste - vuorokausi
  248: { kind: 'solar_forecast', isActualGeneration: false }, // Aurinkovoiman tuotantoennuste - 15 min
  267: { kind: 'solar_capacity', isActualGeneration: false }, // Aurinkovoimaennusteessa kaytetty kokonaiskapasiteetti
};
