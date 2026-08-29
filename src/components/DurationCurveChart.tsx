import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { durationCurve } from '../lib/stats';

interface Props {
  re: Float64Array;
}

export function DurationCurveChart({ re }: Props) {
  const data = useMemo(() => durationCurve(re), [re]);

  return (
    <div className="panel">
      <h2>Renewable production duration curve</h2>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="pct" tickFormatter={(v) => `${v.toFixed(0)}%`} label={{ value: '% of hours', position: 'insideBottom', offset: -2 }} />
          <YAxis label={{ value: 'RE output (pu)', angle: -90, position: 'insideLeft' }} />
          <Tooltip formatter={(v) => Number(v).toFixed(3)} labelFormatter={(v) => `${Number(v).toFixed(1)}% of hours`} />
          <Line type="monotone" dataKey="value" stroke="#16a34a" dot={false} strokeWidth={2} isAnimationActive={false} name="Total RE" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
