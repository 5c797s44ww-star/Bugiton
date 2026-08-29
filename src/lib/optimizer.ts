import type { LoadAllocationResult, MixPoint, OptimizationResult, Params } from './types';

/**
 * Ascending order of hours by baseRE[t] = windShare*windCF[t] + solarShare*solarCF[t].
 * Since RE[t] at any total capacity T is just T * baseRE[t] (T > 0), this order is also
 * the ascending order of "needed load increment" at *any* T for this wind/solar mix, so
 * it can be computed once per mix and reused across every bisection step on T.
 */
export function computeMixOrder(windCF: Float64Array, solarCF: Float64Array, windShare: number): Int32Array {
  const n = windCF.length;
  const solarShare = 1 - windShare;
  const baseRE = new Float64Array(n);
  for (let t = 0; t < n; t++) baseRE[t] = windShare * windCF[t] + solarShare * solarCF[t];
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => baseRE[a] - baseRE[b]);
  return Int32Array.from(order);
}

/**
 * Inner level: for fixed wind/solar capacity (pu), distribute the DC load within the
 * flexibility band [lower, upper] to maximize renewable energy actually consumed,
 * subject to average(load) === utilization exactly. Water-filling on the piecewise
 * linear/concave "covered energy" benefit function, per hour.
 *
 * `order` may be a precomputed ascending-need ordering (see computeMixOrder) for the
 * same wind/solar mix ratio, to avoid re-sorting on every call (e.g. inside bisection).
 */
export function allocateLoad(
  windCF: Float64Array,
  solarCF: Float64Array,
  windCapacityPu: number,
  solarCapacityPu: number,
  utilization: number,
  flexibility: number,
  order?: Int32Array,
): LoadAllocationResult {
  const n = windCF.length;
  const lower = Math.max(0, utilization * (1 - flexibility));
  const upper = Math.min(1, utilization * (1 + flexibility));

  const re = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    re[t] = windCF[t] * windCapacityPu + solarCF[t] * solarCapacityPu;
  }

  const load = new Float64Array(n).fill(lower);
  const capRange = upper - lower;
  const remaining = n * (utilization - lower);

  if (remaining > 1e-12 && capRange > 1e-12) {
    const ord = order ?? Int32Array.from(Array.from({ length: n }, (_, i) => i).sort((a, b) => re[a] - re[b]));

    const x = new Float64Array(n);
    let budget = remaining;
    for (let i = 0; i < n; i++) {
      if (budget <= 1e-12) break;
      const t = ord[i];
      const need = Math.max(0, Math.min(re[t], upper) - lower);
      const amt = Math.min(need, budget);
      x[t] = amt;
      budget -= amt;
    }

    if (budget > 1e-9) {
      // Leftover budget: spread evenly across remaining slack (no coverage impact).
      let totalSlack = 0;
      for (let t = 0; t < n; t++) totalSlack += capRange - x[t];
      if (totalSlack > 1e-12) {
        for (let t = 0; t < n; t++) {
          const slack = capRange - x[t];
          x[t] += budget * (slack / totalSlack);
        }
      }
    }

    for (let t = 0; t < n; t++) load[t] = lower + x[t];
  }

  let coveredEnergy = 0;
  let totalDcEnergy = 0;
  for (let t = 0; t < n; t++) {
    coveredEnergy += Math.min(load[t], re[t]);
    totalDcEnergy += load[t];
  }

  return {
    load,
    coveredEnergy,
    totalDcEnergy,
    coverageFraction: totalDcEnergy > 0 ? coveredEnergy / totalDcEnergy : 0,
  };
}

function coverageForCapacity(
  windCF: Float64Array,
  solarCF: Float64Array,
  windShare: number,
  totalCapacity: number,
  utilization: number,
  flexibility: number,
  order: Int32Array,
): number {
  const cw = windShare * totalCapacity;
  const cs = (1 - windShare) * totalCapacity;
  return allocateLoad(windCF, solarCF, cw, cs, utilization, flexibility, order).coverageFraction;
}

/** Bisect on total capacity (pu) for a fixed wind/solar mix to hit the coverage target. */
function minimalCapacityForMix(
  windCF: Float64Array,
  solarCF: Float64Array,
  windShare: number,
  utilization: number,
  flexibility: number,
  coverageTarget: number,
  order: Int32Array,
): { capacity: number; achievedCoverage: number; feasible: boolean } {
  const HARD_CAP = 1000; // pu, generous upper bound on searched overbuild
  if (coverageTarget <= 1e-9) {
    return {
      capacity: 0,
      achievedCoverage: coverageForCapacity(windCF, solarCF, windShare, 0, utilization, flexibility, order),
      feasible: true,
    };
  }

  let lo = 0;
  let hi = 1;
  let hiCoverage = coverageForCapacity(windCF, solarCF, windShare, hi, utilization, flexibility, order);
  while (hiCoverage < coverageTarget && hi < HARD_CAP) {
    lo = hi;
    hi *= 2;
    hiCoverage = coverageForCapacity(windCF, solarCF, windShare, hi, utilization, flexibility, order);
  }

  if (hiCoverage < coverageTarget) {
    return { capacity: hi, achievedCoverage: hiCoverage, feasible: false };
  }

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const cov = coverageForCapacity(windCF, solarCF, windShare, mid, utilization, flexibility, order);
    if (cov >= coverageTarget) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 1e-6) break;
  }

  return {
    capacity: hi,
    achievedCoverage: coverageForCapacity(windCF, solarCF, windShare, hi, utilization, flexibility, order),
    feasible: true,
  };
}

function buildMixPoint(
  windCF: Float64Array,
  solarCF: Float64Array,
  windShare: number,
  params: Params,
): MixPoint {
  const order = computeMixOrder(windCF, solarCF, windShare);
  const { capacity, achievedCoverage, feasible } = minimalCapacityForMix(
    windCF,
    solarCF,
    windShare,
    params.utilization,
    params.flexibility,
    params.coverageTarget,
    order,
  );
  const windCapacityPu = windShare * capacity;
  const solarCapacityPu = (1 - windShare) * capacity;
  const hasCost = params.windCostPerMW != null && params.solarCostPerMW != null;
  const totalCost = hasCost
    ? windCapacityPu * (params.windCostPerMW as number) + solarCapacityPu * (params.solarCostPerMW as number)
    : null;

  return {
    windShare,
    solarShare: 1 - windShare,
    windCapacityPu,
    solarCapacityPu,
    totalOverbuildPu: capacity,
    totalCost,
    achievedCoverage,
    feasible,
  };
}

function range(steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(i / steps);
  return out;
}

export function optimize(
  windCF: Float64Array,
  solarCF: Float64Array,
  params: Params,
): OptimizationResult {
  // Fine scan for actually picking the optimum (1% steps).
  const fineShares = range(100);
  const scan = fineShares.map((w) => buildMixPoint(windCF, solarCF, w, params));

  const hasCost = params.windCostPerMW != null && params.solarCostPerMW != null;
  const byCapacity = [...scan].sort((a, b) => a.totalOverbuildPu - b.totalOverbuildPu);
  const bestCapacity = byCapacity[0];
  const bestCost = hasCost ? [...scan].sort((a, b) => (a.totalCost as number) - (b.totalCost as number))[0] : null;
  const useCost = params.objective === 'cost' && hasCost;
  const best = useCost ? (bestCost as MixPoint) : bestCapacity;

  // Coarse table for the transparency view (10 percentage-point steps: 0,10,...,100),
  // plus the actual optimal share(s) from the fine scan so they are always highlightable
  // even when they fall between coarse steps.
  const coarsePercents = new Set(range(10).map((w) => Math.round(w * 100)));
  coarsePercents.add(Math.round(bestCapacity.windShare * 100));
  if (bestCost) coarsePercents.add(Math.round(bestCost.windShare * 100));
  const transparencyTable = [...coarsePercents].sort((a, b) => a - b).map((pct) => scan[pct]);

  const { load } = allocateLoad(
    windCF,
    solarCF,
    best.windCapacityPu,
    best.solarCapacityPu,
    params.utilization,
    params.flexibility,
  );

  const n = windCF.length;
  const wind = new Float64Array(n);
  const solar = new Float64Array(n);
  const re = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    wind[t] = windCF[t] * best.windCapacityPu;
    solar[t] = solarCF[t] * best.solarCapacityPu;
    re[t] = wind[t] + solar[t];
  }

  const lowerBand = Math.max(0, params.utilization * (1 - params.flexibility));
  const upperBand = Math.min(1, params.utilization * (1 + params.flexibility));

  return { best, bestCapacity, bestCost, scan, transparencyTable, load, re, wind, solar, lowerBand, upperBand };
}
