import type { SurplusDeficitStats } from '../lib/types';
import { num } from '../lib/format';

interface Props {
  stats: SurplusDeficitStats;
}

export function SurplusDeficitPanel({ stats }: Props) {
  return (
    <div className="panel">
      <h2>Surplus &amp; deficit</h2>
      <div className="kpi-grid">
        <div className="kpi-cell">
          <div className="kpi-label">Annual renewable generation</div>
          <div className="kpi-value">{num(stats.annualRenewableGeneration)} pu·h</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Annual surplus</div>
          <div className="kpi-value">{num(stats.annualSurplus)} pu·h</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Annual deficit</div>
          <div className="kpi-value">{num(stats.annualDeficit)} pu·h</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Hours with surplus</div>
          <div className="kpi-value">{stats.hoursWithSurplus} h</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Hours with deficit</div>
          <div className="kpi-value">{stats.hoursWithDeficit} h</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Maximum surplus</div>
          <div className="kpi-value">{num(stats.maxSurplus)} pu</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Maximum deficit</div>
          <div className="kpi-value">{num(stats.maxDeficit)} pu</div>
        </div>
      </div>
    </div>
  );
}
