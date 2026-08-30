import { useState } from 'react';
import { optimizeWithBattery } from '../lib/battery/optimize';
import { optimize } from '../lib/optimizer';
import type { BatteryDurationH, Params } from '../lib/types';
import { mult, pct } from '../lib/format';

interface Props {
  windCF: Float64Array;
  solarCF: Float64Array;
  params: Params;
}

interface Row {
  label: string;
  windShare: number;
  solarShare: number;
  batteryPowerPu: number | null;
  batteryEnergyPuH: number | null;
  totalSystemCapacityPu: number;
  achievedCoverage: number;
}

const NONZERO_DURATIONS: BatteryDurationH[] = [2, 4, 8];

export function BatteryComparisonTable({ windCF, solarCF, params }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [computing, setComputing] = useState(false);

  const compute = () => {
    setComputing(true);
    // Defer so the "Computing…" state actually paints before this (synchronous, ~seconds-long)
    // computation blocks the main thread - there is no worker in this app to offload it to.
    setTimeout(() => {
      const noBatteryParams: Params = { ...params, battery: { ...params.battery, durationH: 0 } };
      const noBattery = optimize(windCF, solarCF, noBatteryParams).bestCapacity;
      const out: Row[] = [
        {
          label: 'No battery',
          windShare: noBattery.windShare,
          solarShare: noBattery.solarShare,
          batteryPowerPu: null,
          batteryEnergyPuH: null,
          totalSystemCapacityPu: noBattery.totalOverbuildPu,
          achievedCoverage: noBattery.achievedCoverage,
        },
      ];
      for (const durationH of NONZERO_DURATIONS) {
        const r = optimizeWithBattery(windCF, solarCF, { ...params, battery: { ...params.battery, durationH } }).best;
        out.push({
          label: `${durationH} h`,
          windShare: r.windShare,
          solarShare: r.solarShare,
          batteryPowerPu: r.batteryPowerPu,
          batteryEnergyPuH: r.batteryEnergyPuH,
          totalSystemCapacityPu: r.totalSystemCapacityPu,
          achievedCoverage: r.achievedCoverage,
        });
      }
      setRows(out);
      setComputing(false);
    }, 20);
  };

  const minCapacity = rows ? Math.min(...rows.map((r) => r.totalSystemCapacityPu)) : null;

  return (
    <div className="panel">
      <h2>Battery impact on the optimal mix</h2>
      <p className="hint">
        Compares the capacity-optimal wind/solar/battery mix across battery durations at the current utilization,
        coverage target and flexibility — specifically to reveal whether storage changes the conclusion that a
        wind-heavy mix is optimal. Computed on demand (evaluates four scenarios, taking a few seconds).
      </p>
      <div className="button-row">
        <button type="button" onClick={compute} disabled={computing}>
          {computing ? 'Computing…' : rows ? 'Recompute' : 'Compare battery durations'}
        </button>
      </div>
      {rows && (
        <div className="table-scroll">
          <table className="mix-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Wind</th>
                <th>Solar</th>
                <th>Battery power</th>
                <th>Battery energy</th>
                <th>Total system capacity</th>
                <th>Achieved coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={minCapacity !== null && r.totalSystemCapacityPu === minCapacity ? 'best-capacity' : undefined}>
                  <td>{r.label}</td>
                  <td>{pct(r.windShare, 0)}</td>
                  <td>{pct(r.solarShare, 0)}</td>
                  <td>{r.batteryPowerPu == null ? '—' : mult(r.batteryPowerPu)}</td>
                  <td>{r.batteryEnergyPuH == null ? '—' : `${r.batteryEnergyPuH.toFixed(2)} pu·h`}</td>
                  <td>{mult(r.totalSystemCapacityPu)}</td>
                  <td>{pct(r.achievedCoverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && (
        <div className="legend-row">
          <span className="legend-swatch best-capacity" /> Smallest total system capacity
        </div>
      )}
    </div>
  );
}
