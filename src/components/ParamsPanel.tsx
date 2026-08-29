import type { ChangeEvent } from 'react';
import type { Params } from '../lib/types';

interface Props {
  params: Params;
  onChange: (patch: Partial<Params>) => void;
  onFileSelected: (file: File) => void;
  onLoadSample: () => void;
  dataInfo: string;
}

function SliderRow({
  label,
  value,
  onChange,
  suffix = '%',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="slider-row">
      <div className="slider-row-head">
        <span>{label}</span>
        <span className="slider-value">
          {Math.round(value * 100)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
    </div>
  );
}

export function ParamsPanel({ params, onChange, onFileSelected, onLoadSample, dataInfo }: Props) {
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = '';
  };

  const hasCost = params.windCostPerMW != null && params.solarCostPerMW != null;

  return (
    <div className="panel params-panel">
      <h2>Parameters</h2>

      <SliderRow
        label="Average DC utilization"
        value={params.utilization}
        onChange={(v) => onChange({ utilization: v })}
      />
      <SliderRow
        label="Renewable coverage target"
        value={params.coverageTarget}
        onChange={(v) => onChange({ coverageTarget: v })}
      />
      <SliderRow
        label="DC flexibility"
        value={params.flexibility}
        onChange={(v) => onChange({ flexibility: v })}
      />

      <div className="field-row">
        <label htmlFor="dc-power">DC nominal power (optional)</label>
        <div className="input-with-unit">
          <input
            id="dc-power"
            type="number"
            min={0}
            placeholder="e.g. 100"
            value={params.dcNominalPowerMW ?? ''}
            onChange={(e) =>
              onChange({ dcNominalPowerMW: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <span>MW</span>
        </div>
      </div>

      <h3>Cost parameters (optional)</h3>
      <div className="field-row">
        <label htmlFor="wind-cost">Wind cost</label>
        <div className="input-with-unit">
          <input
            id="wind-cost"
            type="number"
            min={0}
            placeholder="€/MW"
            value={params.windCostPerMW ?? ''}
            onChange={(e) =>
              onChange({ windCostPerMW: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <span>€/MW</span>
        </div>
      </div>
      <div className="field-row">
        <label htmlFor="solar-cost">Solar cost</label>
        <div className="input-with-unit">
          <input
            id="solar-cost"
            type="number"
            min={0}
            placeholder="€/MW"
            value={params.solarCostPerMW ?? ''}
            onChange={(e) =>
              onChange({ solarCostPerMW: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <span>€/MW</span>
        </div>
      </div>

      {hasCost && (
        <div className="field-row">
          <label>Objective</label>
          <div className="radio-group">
            <label>
              <input
                type="radio"
                name="objective"
                checked={params.objective === 'capacity'}
                onChange={() => onChange({ objective: 'capacity' })}
              />
              Capacity-optimal
            </label>
            <label>
              <input
                type="radio"
                name="objective"
                checked={params.objective === 'cost'}
                onChange={() => onChange({ objective: 'cost' })}
              />
              Cost-optimal
            </label>
          </div>
        </div>
      )}

      <h3>Hourly production data</h3>
      <p className="data-info">{dataInfo}</p>
      <div className="button-row">
        <button type="button" onClick={onLoadSample}>
          Use synthetic demo data
        </button>
        <label className="file-button">
          Upload Fingrid data
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFile}
            hidden
          />
        </label>
      </div>
      <p className="hint">
        CSV or Excel, any layout — wind/solar production forecasts and their capacities are detected automatically
        from column names, sheet names, units and Fingrid dataset IDs. You'll get to confirm the match before it's
        used.
      </p>
    </div>
  );
}
