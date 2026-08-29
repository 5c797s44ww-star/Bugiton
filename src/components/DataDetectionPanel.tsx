import type { AnalyzeResult, BuiltDataset, SeriesCandidate, SeriesKind } from '../lib/discovery';
import { SERIES_KIND_LABEL, SERIES_KINDS } from '../lib/discovery';
import { pct } from '../lib/format';

interface Props {
  fileName: string;
  analysis: AnalyzeResult;
  selection: Partial<Record<SeriesKind, string>>;
  preview: BuiltDataset | null;
  onSelectionChange: (kind: SeriesKind, candidateId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function candidateDescription(c: SeriesCandidate): string {
  const parts = [`sheet "${c.sheetName}"`, `"${c.label}"`];
  if (c.datasetId != null) parts.push(`Fingrid dataset ${c.datasetId}`);
  if (c.isActualGeneration) parts.push('actual generation, not a forecast');
  return parts.join(' · ');
}

const MISSING_HINT: Record<SeriesKind, string> = {
  wind_forecast: 'Expected a column or dataset like "Tuulivoiman tuotantoennuste" / "Wind power production forecast".',
  solar_forecast: 'Expected a column or dataset like "Aurinkovoiman tuotantoennuste" / "Solar power production forecast".',
  wind_capacity: 'Expected a column or dataset like "Tuulivoiman kapasiteetti" / "Wind available capacity".',
  solar_capacity: 'Expected a column or dataset like "Aurinkovoiman kapasiteetti" / "Solar available capacity".',
};

export function DataDetectionPanel({ fileName, analysis, selection, preview, onSelectionChange, onConfirm, onCancel }: Props) {
  const { candidatesByKind, needsConfirmation, missing, warnings } = analysis;
  const canConfirm = missing.length === 0;

  return (
    <div className="panel detection-panel">
      <h2>Data detected</h2>
      <p className="hint">From "{fileName}". Review the automatic match below before running the optimizer.</p>

      <ul className="detection-list">
        {SERIES_KINDS.map((kind) => {
          const candidates = candidatesByKind[kind];
          const isMissing = missing.includes(kind);
          const selectedId = selection[kind];
          const selected = candidates.find((c) => c.id === selectedId);
          const ambiguous = !isMissing && needsConfirmation[kind];

          return (
            <li key={kind} className={`detection-row ${isMissing ? 'status-missing' : ambiguous ? 'status-warn' : 'status-ok'}`}>
              <span className="detection-icon">{isMissing ? '✗' : ambiguous ? '⚠' : '✓'}</span>
              <div className="detection-body">
                <div className="detection-title">{SERIES_KIND_LABEL[kind]}</div>
                {isMissing ? (
                  <div className="detection-missing-hint">Not found. {MISSING_HINT[kind]}</div>
                ) : (
                  <>
                    <div className="detection-selected">
                      {selected ? candidateDescription(selected) : ''}
                      {selected && ` · ${pct(selected.confidence, 0)} confidence`}
                    </div>
                    {candidates.length > 1 && (
                      <select
                        value={selectedId ?? ''}
                        onChange={(e) => onSelectionChange(kind, e.target.value)}
                        className="detection-select"
                      >
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {candidateDescription(c)} ({pct(c.confidence, 0)})
                          </option>
                        ))}
                      </select>
                    )}
                    {ambiguous && (
                      <div className="detection-ambiguous-hint">
                        Multiple possible matches found — please confirm the right one is selected above.
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {preview && (
        <div className="detection-summary">
          <div>
            <strong>Resolution:</strong>{' '}
            {preview.resolutionMinutes == null
              ? 'unknown'
              : preview.resolutionMinutes < 60
                ? `${preview.resolutionMinutes} min → converted to hourly`
                : `${preview.resolutionMinutes} min (already hourly or coarser)`}
          </div>
          <div>
            <strong>Period:</strong>{' '}
            {preview.periodStart && preview.periodEnd
              ? `${preview.periodStart.toLocaleDateString()} – ${preview.periodEnd.toLocaleDateString()}`
              : 'unknown'}
          </div>
          <div>
            <strong>Data quality:</strong> {preview.qualityPercent.toFixed(1)}%
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="detection-warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {!canConfirm && (
        <p className="warning-banner">
          Missing required data: {missing.map((k) => SERIES_KIND_LABEL[k]).join(', ')}. Optimization cannot start until
          wind and solar forecasts and their capacities are all identified.
        </p>
      )}

      <div className="button-row">
        <button type="button" onClick={onConfirm} disabled={!canConfirm}>
          Use detected data
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
