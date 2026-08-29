import type { MixPoint } from '../lib/types';
import { eur, mult, pct } from '../lib/format';

interface Props {
  rows: MixPoint[];
  bestCapacity: MixPoint;
  bestCost: MixPoint | null;
}

export function MixTable({ rows, bestCapacity, bestCost }: Props) {
  const hasCost = bestCost != null;

  return (
    <div className="panel">
      <h2>Wind/solar mix transparency</h2>
      <p className="hint">
        Alternative mixes at coarse steps, each sized to the smallest overbuild that still meets the coverage
        target.
        {hasCost && ' Rows are highlighted for the capacity-optimal and cost-optimal solutions.'}
      </p>
      <div className="table-scroll">
        <table className="mix-table">
          <thead>
            <tr>
              <th>Wind</th>
              <th>Solar</th>
              <th>Total overbuild</th>
              {hasCost && <th>Total cost</th>}
              <th>Achieved coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCapacityBest = Math.abs(r.windShare - bestCapacity.windShare) < 1e-9;
              const isCostBest = bestCost != null && Math.abs(r.windShare - bestCost.windShare) < 1e-9;
              const cls = [isCapacityBest && 'best-capacity', isCostBest && 'best-cost'].filter(Boolean).join(' ');
              return (
                <tr key={r.windShare} className={cls || undefined}>
                  <td>{pct(r.windShare, 0)}</td>
                  <td>{pct(r.solarShare, 0)}</td>
                  <td>{mult(r.totalOverbuildPu)}</td>
                  {hasCost && <td>{r.totalCost != null ? eur(r.totalCost) : '-'}</td>}
                  <td>{pct(r.achievedCoverage)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="legend-row">
        <span className="legend-swatch best-capacity" /> Capacity-optimal
        {hasCost && (
          <>
            <span className="legend-swatch best-cost" /> Cost-optimal
          </>
        )}
      </div>
    </div>
  );
}
