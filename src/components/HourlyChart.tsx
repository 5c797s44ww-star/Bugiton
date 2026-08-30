import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Mode = 'year' | 'month' | 'week' | 'custom';

interface Props {
  timestamps: Date[];
  wind: Float64Array;
  solar: Float64Array;
  load: Float64Array;
  lowerBand: number;
  upperBand: number;
  /** Battery series (charge/discharge in pu, soc in pu·h) - omitted entirely when no battery is active. */
  charge?: Float64Array;
  discharge?: Float64Array;
  soc?: Float64Array;
  batteryEnergyPuH?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function HourlyChart({ timestamps, wind, solar, load, lowerBand, upperBand, charge, discharge, soc, batteryEnergyPuH }: Props) {
  const hasBattery = charge != null && discharge != null && soc != null;
  const [mode, setMode] = useState<Mode>('week');
  const [monthIndex, setMonthIndex] = useState(0);
  const [weekIndex, setWeekIndex] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const n = timestamps.length;
  const minTime = n > 0 ? timestamps[0].getTime() : 0;
  const maxTime = n > 0 ? timestamps[n - 1].getTime() : 0;

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
    const out: {
      time: number;
      wind: number;
      solar: number;
      re: number;
      load: number;
      band: [number, number];
      charge?: number;
      discharge?: number;
      soc?: number;
    }[] = [];
    for (let t = 0; t < n; t++) {
      const time = timestamps[t].getTime();
      if (time < rangeStart || time > rangeEnd) continue;
      out.push({
        time,
        wind: wind[t],
        solar: solar[t],
        re: wind[t] + solar[t],
        load: load[t],
        band: [lowerBand, upperBand],
        charge: hasBattery ? charge![t] : undefined,
        discharge: hasBattery ? discharge![t] : undefined,
        soc: hasBattery ? soc![t] : undefined,
      });
    }
    return out;
  }, [timestamps, wind, solar, load, rangeStart, rangeEnd, lowerBand, upperBand, n, hasBattery, charge, discharge, soc]);

  const hasSolarCapacity = solar.some((v) => v > 1e-9);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const numWeeks = Math.max(1, Math.floor((maxTime - minTime) / (7 * MS_PER_DAY)));

  return (
    <div className="panel">
      <h2>Hourly production &amp; DC load</h2>
      <p className="hint">
        Wind and solar output at the optimizer's chosen capacity mix (capacity factor × installed capacity), each
        drawn from zero — not stacked — so each technology's own shape stays readable even where they overlap.
        {hasSolarCapacity
          ? ' Total renewable generation (wind + solar) is shown as a separate line.'
          : " This mix built ~0 solar capacity (see Optimal solar share in Key results), so solar is flat at zero here even though its resource — visible in the Capacity factors chart above — varies normally."}
      </p>
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
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            scale="time"
          />
          <YAxis label={{ value: 'pu', angle: -90, position: 'insideLeft' }} />
          {hasBattery && (
            <YAxis
              yAxisId="soc"
              orientation="right"
              domain={[0, batteryEnergyPuH && batteryEnergyPuH > 0 ? batteryEnergyPuH : 'auto']}
              label={{ value: 'SOC (pu·h)', angle: 90, position: 'insideRight' }}
            />
          )}
          <Tooltip
            labelFormatter={(t) => new Date(t as number).toLocaleString()}
            formatter={(v) => Number(v).toFixed(3)}
          />
          <Legend />
          <Area
            dataKey="band"
            name="Flexibility band"
            stroke="none"
            fill="#94a3b8"
            fillOpacity={0.18}
            isAnimationActive={false}
          />
          {/* Wind and solar are each drawn from zero (not stacked): stacking them would make
              solar's band trace wind+solar's cumulative height rather than solar's own value,
              which is misleading whenever wind is large and non-seasonal but solar is small and
              highly seasonal - it would visually look like solar has winter output it doesn't. */}
          <Area
            type="monotone"
            dataKey="wind"
            name="Wind generation"
            stroke="#2563eb"
            fill="#2563eb"
            fillOpacity={0.4}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="solar"
            name="Solar generation"
            stroke="#d97706"
            fill="#f59e0b"
            fillOpacity={0.4}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="re"
            name="Total renewable generation"
            stroke="#16a34a"
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="load"
            name="Optimized DC load"
            stroke="#dc2626"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
          {hasBattery && (
            <>
              <Area
                type="monotone"
                dataKey="charge"
                name="Battery charging"
                stroke="#0891b2"
                fill="#0891b2"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="discharge"
                name="Battery discharging"
                stroke="#be123c"
                fill="#be123c"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
              <Line
                yAxisId="soc"
                type="monotone"
                dataKey="soc"
                name="Battery SOC"
                stroke="#7c3aed"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
