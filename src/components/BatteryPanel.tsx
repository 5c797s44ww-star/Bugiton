import type { BatteryDurationH, BatteryParams } from '../lib/types';

export type BatteryCalcStatus = 'none' | 'stale' | 'fresh';

interface Props {
  battery: BatteryParams;
  onChange: (patch: Partial<BatteryParams>) => void;
  calcStatus: BatteryCalcStatus;
  calculating: boolean;
  onCalculate: () => void;
}

const DURATIONS: { value: BatteryDurationH; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 2, label: '2 h' },
  { value: 4, label: '4 h' },
  { value: 8, label: '8 h' },
];

export function BatteryPanel({ battery, onChange, calcStatus, calculating, onCalculate }: Props) {
  return (
    <div className="panel">
      <h2>Battery storage</h2>
      <div className="range-controls">
        {DURATIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            className={battery.durationH === d.value ? 'active' : ''}
            onClick={() => onChange({ durationH: d.value })}
          >
            {d.label}
          </button>
        ))}
      </div>

      {battery.durationH > 0 && (
        <>
          <p className="hint">
            Battery power capacity is optimized automatically for the selected duration; energy capacity = power ×{' '}
            {battery.durationH} h. Charges only from renewable surplus, discharges only to cover DC deficit, never
            both in the same hour. A cyclic state-of-charge constraint (ends where it started) prevents the battery
            from manufacturing free energy from its initial charge.
          </p>
          <div className="field-row">
            <label htmlFor="charge-eff">Charge efficiency</label>
            <div className="input-with-unit">
              <input
                id="charge-eff"
                type="number"
                min={50}
                max={100}
                step={1}
                value={Math.round(battery.chargeEfficiency * 100)}
                onChange={(e) => onChange({ chargeEfficiency: Number(e.target.value) / 100 })}
              />
              <span>%</span>
            </div>
          </div>
          <div className="field-row">
            <label htmlFor="discharge-eff">Discharge efficiency</label>
            <div className="input-with-unit">
              <input
                id="discharge-eff"
                type="number"
                min={50}
                max={100}
                step={1}
                value={Math.round(battery.dischargeEfficiency * 100)}
                onChange={(e) => onChange({ dischargeEfficiency: Number(e.target.value) / 100 })}
              />
              <span>%</span>
            </div>
          </div>
          <p className="hint">
            Round-trip efficiency ≈ {Math.round(battery.chargeEfficiency * battery.dischargeEfficiency * 100)}%.
            Battery capital cost is not modeled in this version — this compares technical feasibility and required
            overbuild only.
          </p>

          <div className="button-row">
            <button type="button" onClick={onCalculate} disabled={calculating}>
              {calculating ? 'Calculating…' : calcStatus === 'fresh' ? 'Recalculate' : 'Calculate battery scenario'}
            </button>
          </div>
          {!calculating && calcStatus === 'none' && (
            <p className="hint">
              Sliders stay instant — the battery simulation (mix × battery size × capacity search) only runs when
              you click Calculate.
            </p>
          )}
          {!calculating && calcStatus === 'stale' && (
            <p className="warning-banner">
              Parameters or data changed since the last calculation. Results below are from the previous settings —
              click Recalculate to update them.
            </p>
          )}
          {!calculating && calcStatus === 'fresh' && <p className="ok-banner">✓ Battery results are up to date.</p>}
        </>
      )}
    </div>
  );
}
