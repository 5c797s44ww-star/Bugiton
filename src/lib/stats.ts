import type { HourlyRecord, SurplusDeficitStats } from './types';

export interface CapacityFactors {
  timestamps: Date[];
  windCF: Float64Array;
  solarCF: Float64Array;
}

export function computeCapacityFactors(records: HourlyRecord[]): CapacityFactors {
  const sorted = [...records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const n = sorted.length;
  const windCF = new Float64Array(n);
  const solarCF = new Float64Array(n);
  const timestamps: Date[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const r = sorted[i];
    timestamps[i] = r.timestamp;
    windCF[i] = r.windCapacity > 0 ? Math.min(1, r.windGeneration / r.windCapacity) : 0;
    solarCF[i] = r.solarCapacity > 0 ? Math.min(1, r.solarGeneration / r.solarCapacity) : 0;
  }

  return { timestamps, windCF, solarCF };
}

export function surplusDeficit(load: Float64Array, re: Float64Array): SurplusDeficitStats {
  const n = load.length;
  let annualRenewableGeneration = 0;
  let annualSurplus = 0;
  let annualDeficit = 0;
  let hoursWithSurplus = 0;
  let hoursWithDeficit = 0;
  let maxSurplus = 0;
  let maxDeficit = 0;

  for (let t = 0; t < n; t++) {
    annualRenewableGeneration += re[t];
    const surplus = Math.max(re[t] - load[t], 0);
    const deficit = Math.max(load[t] - re[t], 0);
    annualSurplus += surplus;
    annualDeficit += deficit;
    if (surplus > 1e-9) hoursWithSurplus++;
    if (deficit > 1e-9) hoursWithDeficit++;
    if (surplus > maxSurplus) maxSurplus = surplus;
    if (deficit > maxDeficit) maxDeficit = deficit;
  }

  return {
    annualRenewableGeneration,
    annualSurplus,
    annualDeficit,
    hoursWithSurplus,
    hoursWithDeficit,
    maxSurplus,
    maxDeficit,
  };
}

export function durationCurve(values: Float64Array): { pct: number; value: number }[] {
  const sorted = Array.from(values).sort((a, b) => b - a);
  const n = sorted.length;
  return sorted.map((value, i) => ({ pct: (i / (n - 1)) * 100, value }));
}
