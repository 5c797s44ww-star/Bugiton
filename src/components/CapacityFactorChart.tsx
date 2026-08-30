import { useMemo, useState } from 'react';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { pct } from '../lib/format';

type Mode = 'year' | 'month' | 'week' | 'custom';

interface Props {
  timestamps: Date[];
  windCF: Float64Array;
  solarCF: Float64Array;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-cell">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

export function CapacityFactorChart({ timestamps, windCF, solarCF }: Props) {
  const [mode, setMode] = useState<Mode>('week');
  const [monthIndex, setMonthIndex] = useState(0);
  const [weekIndex, setWeekIndex] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const n = timestamps.length;
  const minTime = n > 0 ? timestamps[0].getTime() : 0;
  const maxTime = n > 0 ? timestamps[n - 1].getTime() : 0;

  const stats = useMemo(() => {
    let windSum = 0;
    let solarSum = 0;
    let windMax = 0;
    let solarMax = 0;
    let windNonzero = 0;
    let solarNonzero = 0;
    for (let i = 0; i < n; i++) {
      windSum += windCF[i];
      solarSum += solarCF[i];
      if (windCF[i] > windMax) windMax = windCF[i];
      if (solarCF[i] > solarMax) solarMax = solarCF[i];
      if (windCF[i] > 1e-6) windNonzero++;
      if (solarCF[i] > 1e-6) solarNonzero++;
    }
    return {
      windAvg: n > 0 ? windSum / n : 0,
      solarAvg: n > 0 ? solarSum / n : 0,
      windMax,
      solarMax,
      windNonzeroFrac: n > 0 ? windNonzero / n : 0,
      solarNonzeroFrac: n > 0 ? solarNonzero / n : 0,
    };
  }, [windCF, solarCF, n]);

  const [rangeStart, rangeEnd] = useMemo((): [number, number] => {
    if (mode === 'year') return [minTime, maxTime];
    if (mode === 'month') {
      const d = new Date(timestamps[0] ?? new Date());
      const s = new Date(d.getFullYear(), monthIndex, 1).getTime();
      const e = new Date(d.getFullYear(), monthIndex + 1, 1).getTime();
      return [s, e];
    }
    if (mode === 'week') {
      const s = minTime + weekIndex * 7 * MS_PER_DAY;
      return [s, s + 7 * MS_PER_DAY];
    }
    const s = customStart ? new Date(customStart).getTime() : minTime;
    const e = customEnd ? new Date(customEnd).getTime() : maxTime;
    return [s, e];
  }, [mode, monthIndex, weekIndex, customStart, customEnd, minTime, maxTime, timestamps]);

  const data = useMemo(() => {
    const out: { time: number; windCF: number; solarCF: number }[] = [];
    for (let t = 0; t < n; t++) {
      const time = timestamps[t].getTime();
      if (time < rangeStart || time > rangeEnd) continue;
      out.push({ time, windCF: windCF[t], solarCF: solarCF[t] });
    }
    return out;
  }, [timestamps, windCF, solarCF, rangeStart, rangeEnd, n]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const numWeeks = Math.max(1, Math.floor((maxTime - minTime) / (7 * MS_PER_DAY)));

  return (
    <div className="panel">
      <h2>Capacity factors (normalized production)</h2>
      <p className="hint">
        wind_CF and solar_CF exactly as computed from the uploaded data — production divided by the capacity
        applicable at that timestamp — before the optimizer scales anything. Use this to sanity-check ingestion:
        solar should show a clear diurnal and seasonal shape peaking well above its own average, not sit near zero
        everywhere or exceed 1.
      </p>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <StatCell label="Average wind CF" value={pct(stats.windAvg)} />
        <StatCell label="Average solar CF" value={pct(stats.solarAvg)} />
        <StatCell label="Max wind CF" value={pct(stats.windMax)} />
        <StatCell label="Max solar CF" value={pct(stats.solarMax)} />
        <StatCell label="Hours with wind CF > 0" value={pct(stats.windNonzeroFrac, 0)} />
        <StatCell label="Hours with solar CF > 0" value={pct(stats.solarNonzeroFrac, 0)} />
      </div>

      <div className="range-controls">
        {(['year', 'month', 'week', 'custom'] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {m === 'year' ? 'Full year' : m === 'month' ? 'Month' : m === 'week' ? 'Week' : 'Custom'}
          </button>
        ))}
        {mode === 'month' && (
          <select value={monthIndex} onChange={(e) => setMonthIndex(Number(e.target.value))}>
            {monthNames.map((mn, i) => (
              <option key={mn} value={i}>
                {mn}
              </option>
            ))}
          </select>
        )}
        {mode === 'week' && (
          <input
            type="range"
            min={0}
            max={numWeeks - 1}
            value={weekIndex}
            onChange={(e) => setWeekIndex(Number(e.target.value))}
          />
        )}
        {mode === 'custom' && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span>to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            scale="time"
          />
          <YAxis domain={[0, 1]} label={{ value: 'CF', angle: -90, position: 'insideLeft' }} />
          <Tooltip
            labelFormatter={(t) => new Date(t as number).toLocaleString()}
            formatter={(v) => Number(v).toFixed(3)}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="windCF"
            name="Wind CF"
            stroke="#2563eb"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="solarCF"
            name="Solar CF"
            stroke="#d97706"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
