import type { MixPoint, Params } from '../lib/types';
import { eur, mult, mw, num, pct } from '../lib/format';

interface Props {
  params: Params;
  best: MixPoint;
  load: Float64Array;
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

export function KpiTable({ params, best, load }: Props) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of load) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const dcMW = params.dcNominalPowerMW;
  const hasCost = best.totalCost != null;

  return (
    <div className="panel">
      <h2>Key results</h2>
      {!best.feasible && (
        <p className="warning-banner">
          Target coverage could not be reached within the searched overbuild range (up to 1000×) for this mix.
          Shown values are the best achievable.
        </p>
      )}
      <div className="kpi-grid">
        <Row label="Average utilization" value={pct(params.utilization)} />
        <Row label="Renewable coverage (achieved)" value={pct(best.achievedCoverage)} sub={`target ${pct(params.coverageTarget)}`} />
        <Row label="DC flexibility" value={pct(params.flexibility)} />
        <Row label="Optimal wind share" value={pct(best.windShare, 0)} />
        <Row label="Optimal solar share" value={pct(best.solarShare, 0)} />
        <Row
          label="Wind overbuild"
          value={mult(best.windCapacityPu)}
          sub={dcMW ? mw(best.windCapacityPu * dcMW) : undefined}
        />
        <Row
          label="Solar overbuild"
          value={mult(best.solarCapacityPu)}
          sub={dcMW ? mw(best.solarCapacityPu * dcMW) : undefined}
        />
        <Row
          label="Total overbuild"
          value={mult(best.totalOverbuildPu)}
          sub={dcMW ? mw(best.totalOverbuildPu * dcMW) : undefined}
        />
        <Row label="Minimum hourly load" value={`${num(min)} pu`} />
        <Row label="Maximum hourly load" value={`${num(max)} pu`} />
        {hasCost && <Row label="Total cost" value={eur(best.totalCost as number)} sub={params.objective === 'cost' ? 'cost-optimal mix' : 'capacity-optimal mix'} />}
      </div>
    </div>
  );
}
