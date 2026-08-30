import type { BatteryDispatchResult, BatteryMixPoint, Params } from '../lib/types';
import { mult, mw, mwh, num, pct } from '../lib/format';

interface Props {
  params: Params;
  best: BatteryMixPoint;
  dispatch: BatteryDispatchResult;
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-cell">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function BatteryKpiPanel({ params, best, dispatch }: Props) {
  const dcMW = params.dcNominalPowerMW;
  const durationH = params.battery.durationH;
  const socPercentOfCapacity = best.batteryEnergyPuH > 1e-9 ? dispatch.maxSoc / best.batteryEnergyPuH : 0;

  return (
    <div className="panel">
      <h2>Battery</h2>
      <div className="kpi-grid">
        <Row label="Battery duration" value={`${durationH} h`} />
        <Row label="Battery power" value={mult(best.batteryPowerPu)} sub={dcMW ? mw(best.batteryPowerPu * dcMW) : undefined} />
        <Row
          label="Battery energy"
          value={`${num(best.batteryEnergyPuH)} pu·h`}
          sub={dcMW ? mwh(best.batteryEnergyPuH * dcMW) : 'MWh per MW of DC capacity'}
        />
        <Row label="Maximum SOC" value={pct(socPercentOfCapacity, 0)} sub={`${num(dispatch.maxSoc)} pu·h`} />
        <Row label="Battery cycles" value={`${num(dispatch.cycles, 1)} / period`} />
      </div>

      <h2 style={{ marginTop: 20 }}>System (with battery)</h2>
      <div className="kpi-grid">
        <Row label="Wind overbuild" value={mult(best.windCapacityPu)} sub={dcMW ? mw(best.windCapacityPu * dcMW) : undefined} />
        <Row label="Solar overbuild" value={mult(best.solarCapacityPu)} sub={dcMW ? mw(best.solarCapacityPu * dcMW) : undefined} />
        <Row label="Battery power overbuild" value={mult(best.batteryPowerPu)} sub={dcMW ? mw(best.batteryPowerPu * dcMW) : undefined} />
        <Row
          label="Total system capacity"
          value={mult(best.totalSystemCapacityPu)}
          sub={dcMW ? mw(best.totalSystemCapacityPu * dcMW) : undefined}
        />
        <Row label="Renewable coverage" value={pct(best.achievedCoverage)} sub={`target ${pct(params.coverageTarget)}`} />
        <Row
          label="Annual renewable energy delivered"
          value={`${num(dispatch.coveredEnergy)} pu·h`}
          sub={dcMW ? mwh(dispatch.coveredEnergy * dcMW) : undefined}
        />
        <Row
          label="Annual curtailed renewable energy"
          value={`${num(dispatch.curtailedEnergy)} pu·h`}
          sub={dcMW ? mwh(dispatch.curtailedEnergy * dcMW) : undefined}
        />
        <Row
          label="Annual energy from other sources"
          value={`${num(dispatch.otherSourceEnergy)} pu·h`}
          sub={dcMW ? mwh(dispatch.otherSourceEnergy * dcMW) : undefined}
        />
      </div>
      {!best.feasible && (
        <p className="warning-banner">
          Target coverage could not be reached within the searched overbuild range for this mix and battery
          duration. Shown values are the best achievable.
        </p>
      )}
    </div>
  );
}
